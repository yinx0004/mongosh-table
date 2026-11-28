#!/usr/bin/env bash
# Run test/compat.js in Docker against a throwaway single-node replica set.
#
#   test/run.sh <mongodb image> [client image]
#   test/run.sh mongo:7.0                 # server 7.0, mongosh bundled in mongo:7.0
#   test/run.sh mongo:4.4 mongo:6.0.4     # server 4.4, mongosh 1.8.0
#   test/run.sh mongo:4.0                 # server 4.0, its legacy mongo shell
#   MONGO_SHELL=mongo test/run.sh mongo:5.0   # force the legacy shell where both exist
#
# The client image supplies the shell: mongosh if it has one, otherwise the
# legacy mongo shell (MongoDB 5.0 and earlier). MONGO_SHELL overrides that.
set -euo pipefail

server=${1:?usage: test/run.sh <mongodb image> [client image]}
client=${2:-$server}
root=$(cd "$(dirname "$0")/.." && pwd)
name=mongotab-test-$$
net=$name-net

shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$client" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}
if [ "$shell" = mongosh ]; then
  uri="mongodb://$name:27017/test?directConnection=true"
else
  uri="mongodb://$name:27017/test"
fi

cleanup() {
  # -v: also remove the anonymous /data/db volume, or every run leaves one behind
  docker rm -f -v "$name" "$name-slow" "$name-writer" "$name-builder" >/dev/null 2>&1 || true
  rm -f "$root/tmp/audit-$name.log"   # the server log saved for the read-only audit, also when it failed
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
# enableTestCommands: compat.js uses a fail point to pause an index build for mt.builds().
docker run -d --name "$name" --network "$net" "$server" mongod --replSet rs0 --bind_ip_all --setParameter enableTestCommands=1 >/dev/null

msh() { docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$uri" "$@"; }

wait_for() {
  for _ in $(seq 1 60); do
    [ "$(msh --eval "print($1)" 2>/dev/null | tail -n 1)" = true ] && return 0
    sleep 1
  done
  echo "timed out waiting for: $1" >&2
  docker logs "$name" 2>&1 | tail -n 20 >&2
  return 1
}

wait_for 'db.adminCommand({ping: 1}).ok === 1'
msh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: '$name:27017'}]}).ok" >/dev/null
wait_for '(db.hello ? db.hello().isWritablePrimary : db.isMaster().ismaster)'

# Data for the mt.builds() index build (see the builder below). Created before
# the slow query starts: on old versions creating or dropping a database can
# interrupt a running query.
msh --eval "var docs = []; for (var i = 0; i < 5000; i++) docs.push({a: i, b: 'x'}); db.getSiblingDB('mtbuild').c.insertMany(docs)" >/dev/null

# A long-running query for mt.ps() to find (~2 minutes). It lives in its own
# database: on 4.0, dropping or indexing another collection in the same
# database interrupts it.
msh --eval "db.getSiblingDB('mtslow').slow.drop(); db.getSiblingDB('mtslow').slow.insert({_id: 1})" >/dev/null
docker run -d --name "$name-slow" --network "$net" --entrypoint "$shell" "$client" --quiet "$uri" \
  --eval "db.getSiblingDB('mtslow').slow.find({\$where: 'sleep(120000) || true'}).toArray()" >/dev/null

# A writer for mt.locks(): it inserts every 200 ms (~4 minutes), so while
# compat.js holds db.fsyncLock() it queues for the global lock. It uses w: 1:
# with the default majority write concern (5.0+) an insert can instead hang
# waiting for the journal, which fsyncLock also blocks, and never show up as
# waiting for a lock.
docker run -d --name "$name-writer" --network "$net" --entrypoint "$shell" "$client" --quiet "$uri" \
  --eval "for (var i = 0; i < 1200; i++) { db.getSiblingDB('mtlock').c.insertOne({i: i}, {writeConcern: {w: 1}}); sleep(200); }" >/dev/null

# A builder for mt.builds(): it waits for compat.js to insert mtbuild.go (after
# turning on a fail point that pauses index builds), then builds an index.
docker run -d --name "$name-builder" --network "$net" --entrypoint "$shell" "$client" --quiet "$uri" \
  --eval "var d = db.getSiblingDB('mtbuild'); for (var i = 0; i < 1500 && !d.go.findOne(); i++) sleep(200); if (d.go.findOne()) d.c.createIndex({a: 1, b: 1}, {background: true})" >/dev/null

msh test/compat.js

# Read-only audit: log every command (command log level 1), run every mt command
# from its own client container (test/audit.js), then check that the server log
# shows nothing but read-only commands from that client (test/audit-check.js).
# The audit's connections are the ones the server accepted from the audit
# client's address between two readings of serverStatus().localTime (the clock
# the log uses): the 3.6 shell does not send the appName in the connection
# string. The readings run in shells of their own, apart from the setLogLevel
# calls, so a shell that happens to get the same address adds only reads.
msh test/audit-data.js >/dev/null
case "$uri" in *\?*) auri="$uri&appName=mongotab-audit" ;; *) auri="$uri?appName=mongotab-audit" ;; esac
msh --eval "db.setLogLevel(1, 'command')" >/dev/null
from=$(msh --eval "print(db.serverStatus().localTime.toISOString())" | tail -n 1)
aout=$(docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$auri" test/audit.js)
echo "$aout"
to=$(msh --eval "print(db.serverStatus().localTime.toISOString())" | tail -n 1)
msh --eval "db.setLogLevel(0, 'command')" >/dev/null
ip=$(echo "$aout" | sed -n 's/^audit client: \([0-9.]*\):.*/\1/p')
mkdir -p "$root/tmp"
log="tmp/audit-$name.log"
docker logs "$name" > "$root/$log" 2>&1
docker run --rm -i -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet --nodb \
  --eval "var AUDIT = {log: '/w/$log', from: '$from', to: '$to', ip: '$ip'}" test/audit-check.js
