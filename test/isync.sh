#!/usr/bin/env bash
# Run test/isync.js in Docker: a primary with some data, and a new member that
# goes through initial sync, held at points along the way with failpoints
# (both mongods run with enableTestCommands=1):
#   clone    the first two attempts fail (failInitialSyncWithBadHost), the third
#            hangs part way through copying shop.orders
#   primary  mt.initialSync() on the primary while the new member syncs
#   finish   the copy is done; held just before initial sync finishes
#   after    the new member is a SECONDARY
#
#   test/isync.sh <mongodb image> [client image]
#   test/isync.sh mongo:7.0
#   test/isync.sh mongo:4.4 mongo:6.0.4          # mongosh 1.8.0
#   MONGO_SHELL=mongo test/isync.sh mongo:3.6    # legacy shell
set -euo pipefail

server=${1:?usage: test/isync.sh <mongodb image> [client image]}
client=${2:-$server}
root=$(cd "$(dirname "$0")/.." && pwd)
name=mtisync-$$
net=$name-net

shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$client" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}

cleanup() {
  docker rm -f -v "$name-p" "$name-s" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
for m in p s; do
  docker run -d --name "$name-$m" --network "$net" "$server" mongod --replSet rs --bind_ip_all --setParameter enableTestCommands=1 >/dev/null
done

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
srv p --eval "rs.initiate({_id: 'rs', members: [{_id: 0, host: '$name-p:27017'}]}).ok" >/dev/null
wait_true p 'db.isMaster().ismaster'
# about 28 MB in three collections, 1 KB per document
srv p --eval '
  var pad = "x"; for (var k = 0; k < 10; k++) pad += pad;
  var fill = function (c, n) { for (var b = 0; b < n; b += 1000) { var d = []; for (var i = b; i < b + 1000 && i < n; i++) d.push({_id: i, pad: pad}); c.insertMany(d); } };
  fill(db.getSiblingDB("shop").orders, 20000); fill(db.getSiblingDB("shop").users, 5000); fill(db.getSiblingDB("crm").contacts, 3000);' >/dev/null
srv s --eval '
  db.adminCommand({configureFailPoint: "failInitialSyncWithBadHost", mode: {times: 2}});
  db.adminCommand({configureFailPoint: "initialSyncHangDuringCollectionClone", mode: "alwaysOn", data: {namespace: "shop.orders", numDocsToClone: 5000}});' >/dev/null
# no votes, so majority writes on the primary do not wait for it
srv p --eval "rs.add({host: '$name-s:27017', priority: 0, votes: 0}).ok" >/dev/null
wait_true s 'function () { var s = db.adminCommand({replSetGetStatus: 1, initialSync: 1}).initialSyncStatus; var d = s && s.databases && s.databases.shop; return !!(d && d["shop.orders"] && d["shop.orders"].documentsCopied > 0); }()'

msh() {
  local m=$1; shift
  local uri="mongodb://$name-$m:27017/test"
  [ "$shell" = mongosh ] && uri="$uri?directConnection=true"
  docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$uri" "$@"
}
vars="var MT_PRIMARY = '$name-p:27017'; var MT_NEW = '$name-s:27017'"

msh s --eval "var MT_PHASE = 'clone'; $vars" test/isync.js
# the primary learns the new member's state from heartbeats
wait_true p 'rs.status().members.some(function (m) { return m.state === 5; })'
msh p --eval "var MT_PHASE = 'primary'; $vars" test/isync.js

srv s --eval '
  db.adminCommand({configureFailPoint: "initialSyncHangBeforeFinish", mode: "alwaysOn"});
  db.adminCommand({configureFailPoint: "initialSyncHangDuringCollectionClone", mode: "off"});' >/dev/null
wait_true s 'function () { var s = db.adminCommand({replSetGetStatus: 1, initialSync: 1}).initialSyncStatus; return !!(s && s.initialSyncEnd); }()'
msh s --eval "var MT_PHASE = 'finish'; $vars" test/isync.js

srv s --eval 'db.adminCommand({configureFailPoint: "initialSyncHangBeforeFinish", mode: "off"})' >/dev/null
wait_true s 'db.adminCommand({replSetGetStatus: 1}).myState === 2'
msh s --eval "var MT_PHASE = 'after'; $vars" test/isync.js
