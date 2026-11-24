#!/usr/bin/env bash
# Run test/flow.js in Docker against a throwaway two-member replica set, to see
# mt.flow() before, during and after flow control throttles the primary:
#   normal     both members in step
#   lagged     the secondary is fsyncLock'ed (it stops applying the oplog) while a
#              writer keeps inserting on the primary, with flowControlTargetLagSeconds
#              lowered to 2 so throttling starts after 1 second of lag
#   after      the secondary unlocked and caught up
#   secondary  mt.flow() run on the secondary
#
#   test/flow.sh <mongodb image> [client image]
#   test/flow.sh mongo:7.0
#   test/flow.sh mongo:4.4 mongo:6.0.4          # mongosh 1.8.0
#   MONGO_SHELL=mongo test/flow.sh mongo:4.2    # legacy shell
set -euo pipefail

server=${1:?usage: test/flow.sh <mongodb image> [client image]}
client=${2:-$server}
root=$(cd "$(dirname "$0")/.." && pwd)
name=mtflow-$$
net=$name-net

shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$client" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}

cleanup() {
  docker rm -f -v "$name-p" "$name-s" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
for m in p s; do docker run -d --name "$name-$m" --network "$net" "$server" mongod --replSet rs --bind_ip_all >/dev/null; done

# Setup and the writer use the shell in the server image.
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
wait_true p 'db.adminCommand({ping: 1}).ok === 1'
wait_true s 'db.adminCommand({ping: 1}).ok === 1'
srv p --eval "rs.initiate({_id: 'rs', members: [{_id: 0, host: '$name-p:27017', priority: 2}, {_id: 1, host: '$name-s:27017'}]}).ok" >/dev/null
wait_true p 'db.isMaster().ismaster && rs.status().members.every(function (m) { return m.state === 1 || m.state === 2; })'
srv p --eval "db.getSiblingDB('mtflow').t.insertOne({x: 0}, {writeConcern: {w: 2}})" >/dev/null

msh() {
  local m=$1; shift
  local uri="mongodb://$name-$m:27017/test"
  [ "$shell" = mongosh ] && uri="$uri?directConnection=true"
  docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$uri" "$@"
}

msh p --eval "var MT_PHASE = 'normal'" test/flow.js

srv p --eval 'db.adminCommand({setParameter: 1, flowControlTargetLagSeconds: 2}).ok' >/dev/null
srv s --eval 'db.fsyncLock().ok' >/dev/null
# w: 1, since from 5.0 the default write concern would wait for the locked secondary
docker exec -d "$name-p" "$srvshell" --quiet --eval '
  var c = db.getSiblingDB("mtflow").t, t0 = Date.now(), n = 0;
  while (Date.now() - t0 < 25000) c.insertOne({x: n++}, {writeConcern: {w: 1}});'
sleep 10
msh p --eval "var MT_PHASE = 'lagged'; var MT_SECONDARY = '$name-s:27017'" test/flow.js

srv s --eval 'db.fsyncUnlock().ok' >/dev/null
sleep 16   # the writer stops 25 seconds after it started
wait_true p 'db.serverStatus().flowControl.isLagged === false'
msh p --eval "var MT_PHASE = 'after'" test/flow.js
msh s --eval "var MT_PHASE = 'secondary'" test/flow.js
