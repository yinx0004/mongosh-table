#!/usr/bin/env bash
# Run test/concern.js in Docker against a throwaway PSA replica set (primary,
# secondary, arbiter); the primary counts write concerns
# (reportOpWriteConcernCountersInServerStatus=true, startup only). mongosh
# connects with w / readConcernLevel / readPreference in the connection string;
# the legacy shell ignores those and test/concern.js sets them instead.
#
#   test/concern.sh <mongodb image> [client image]
#   test/concern.sh mongo:7.0
#   test/concern.sh mongo:4.4 mongo:6.0.4          # mongosh 1.8.0
#   MONGO_SHELL=mongo test/concern.sh mongo:4.2    # legacy shell
set -euo pipefail

server=${1:?usage: test/concern.sh <mongodb image> [client image]}
client=${2:-$server}
root=$(cd "$(dirname "$0")/.." && pwd)
name=mtconcern-$$
net=$name-net

shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$client" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}

cleanup() {
  docker rm -f -v "$name-p" "$name-s" "$name-a" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
# the counters need 4.4+; older versions do not know the parameter
param=$(docker run --rm --entrypoint mongod "$server" --version | grep -qE 'db version v(3\.|4\.[0-2]\.)' && echo '' || echo '--setParameter reportOpWriteConcernCountersInServerStatus=true')
docker run -d --name "$name-p" --network "$net" "$server" mongod --replSet rs --bind_ip_all $param >/dev/null
for m in s a; do docker run -d --name "$name-$m" --network "$net" "$server" mongod --replSet rs --bind_ip_all >/dev/null; done

srvshell=$(docker exec "$name-p" sh -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')
srv() { local m=$1; shift; docker exec "$name-$m" "$srvshell" --quiet "$@"; }
wait_true() {
  local m=$1 cond=$2
  for _ in $(seq 1 90); do
    [ "$(srv "$m" --eval "print($cond)" 2>/dev/null | tail -n 1)" = true ] && return 0
    sleep 1
  done
  echo "timed out waiting on $m for: $cond" >&2
  return 1
}
for m in p s a; do wait_true "$m" 'db.adminCommand({ping: 1}).ok === 1'; done
srv p --eval "rs.initiate({_id: 'rs', members: [{_id: 0, host: '$name-p:27017', priority: 2}, {_id: 1, host: '$name-s:27017'}, {_id: 2, host: '$name-a:27017', arbiterOnly: true}]}).ok" >/dev/null
wait_true p 'db.isMaster().ismaster && rs.status().members.every(function (m) { return m.state === 1 || m.state === 2 || m.state === 7; })'

uri="mongodb://$name-p:27017/test"
[ "$shell" = mongosh ] && uri="$uri?directConnection=true&w=majority&readConcernLevel=majority&readPreference=secondaryPreferred"
docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$uri" test/concern.js
