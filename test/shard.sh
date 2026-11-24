#!/usr/bin/env bash
# Run test/shard.js (or the given script) in Docker against a throwaway sharded
# cluster: a config server replica set, three one-node shard replica sets and a
# mongos.
#
#   test/shard.sh <mongodb image> [client image] [script]
#   test/shard.sh mongo:7.0
#   test/shard.sh mongo:4.4 mongo:6.0.4          # mongosh 1.8.0
#   MONGO_SHELL=mongo test/shard.sh mongo:3.6    # legacy shell
#
# With no script given, it runs test/shard.js, then stops sh3 and runs
# test/shard-down.js.
#
# The cluster is set up so that mt.shards() has something to show:
#   shop.orders  range-sharded on {customerId: 1}, split into chunks on sh1 / sh2
#   shop.events  hash-sharded on {_id: 'hashed'}
#   crm          unsharded, primary shard sh2
#   sh2          in zone EU; sh3 empty and draining (removeShard called once)
#   the balancer is stopped, so chunks stay where they were put
set -euo pipefail

server=${1:?usage: test/shard.sh <mongodb image> [client image] [script]}
client=${2:-$server}
script=${3:-test/shard.js}
root=$(cd "$(dirname "$0")/.." && pwd)
name=${MT_NAME:-mtshard-$$}   # MT_NAME：容器名前缀（README 示例用来让主机名好读）
net=$name-net

shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$client" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}

cleanup() {
  # -v: also remove the anonymous /data/db volumes
  docker rm -f -v "$name-cfg" "$name-sh1" "$name-sh2" "$name-sh3" "$name-mongos" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
docker run -d --name "$name-cfg" --network "$net" "$server" mongod --configsvr --replSet cfg --port 27017 --bind_ip_all >/dev/null
for s in sh1 sh2 sh3; do
  docker run -d --name "$name-$s" --network "$net" "$server" mongod --shardsvr --replSet "$s" --port 27017 --bind_ip_all >/dev/null
done

# mongo / mongosh against one host; directConnection only for mongosh
msh() {
  local host=$1; shift
  local uri="mongodb://$host:27017/test"
  [ "$shell" = mongosh ] && uri="$uri?directConnection=true"
  docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$uri" "$@"
}
wait_for() {
  local host=$1 cond=$2
  for _ in $(seq 1 90); do
    [ "$(msh "$host" --eval "print($cond)" 2>/dev/null | tail -n 1)" = true ] && return 0
    sleep 1
  done
  echo "timed out waiting on $host for: $cond" >&2
  docker logs "$host" 2>&1 | tail -n 20 >&2
  return 1
}
primary='(db.hello ? db.hello().isWritablePrimary : db.isMaster().ismaster)'

wait_for "$name-cfg" 'db.adminCommand({ping: 1}).ok === 1'
msh "$name-cfg" --eval "rs.initiate({_id: 'cfg', configsvr: true, members: [{_id: 0, host: '$name-cfg:27017'}]}).ok" >/dev/null
for s in sh1 sh2 sh3; do
  wait_for "$name-$s" 'db.adminCommand({ping: 1}).ok === 1'
  msh "$name-$s" --eval "rs.initiate({_id: '$s', members: [{_id: 0, host: '$name-$s:27017'}]}).ok" >/dev/null
done
wait_for "$name-cfg" "$primary"
for s in sh1 sh2 sh3; do wait_for "$name-$s" "$primary"; done

docker run -d --name "$name-mongos" --network "$net" "$server" mongos --configdb "cfg/$name-cfg:27017" --port 27017 --bind_ip_all >/dev/null
wait_for "$name-mongos" 'db.adminCommand({ping: 1}).ok === 1'

msh "$name-mongos" --eval "
  var a = db.getSiblingDB('admin');
  ['sh1', 'sh2', 'sh3'].forEach(function (s) { a.runCommand({ addShard: s + '/$name-' + s + ':27017', name: s }); });
  sh.stopBalancer();
  a.runCommand({ removeShard: 'sh3' });   // 先开始排空，后面建的块不会放到 sh3
  a.runCommand({ enableSharding: 'shop' });
  if (db.getSiblingDB('config').databases.findOne({ _id: 'shop' }).primary !== 'sh1') a.runCommand({ movePrimary: 'shop', to: 'sh1' });
  var o = db.getSiblingDB('shop').orders, docs = [];
  for (var i = 0; i < 4000; i++) docs.push({ customerId: i % 400, orderNo: 'SO' + i, amount: i % 500 });
  o.insertMany(docs);
  o.createIndex({ customerId: 1 });
  a.runCommand({ shardCollection: 'shop.orders', key: { customerId: 1 } });
  [100, 200, 300].forEach(function (k) { a.runCommand({ split: 'shop.orders', middle: { customerId: k } }); });
  a.runCommand({ moveChunk: 'shop.orders', find: { customerId: 250 }, to: 'sh2' });
  a.runCommand({ moveChunk: 'shop.orders', find: { customerId: 350 }, to: 'sh2' });
  a.runCommand({ shardCollection: 'shop.events', key: { _id: 'hashed' } });
  db.getSiblingDB('shop').events.insertMany([{ e: 1 }, { e: 2 }, { e: 3 }]);
  a.runCommand({ enableSharding: 'crm' });
  db.getSiblingDB('crm').contacts.insertOne({ n: 1 });
  if (db.getSiblingDB('config').databases.findOne({ _id: 'crm' }).primary !== 'sh2') a.runCommand({ movePrimary: 'crm', to: 'sh2' });
  a.runCommand({ addShardToZone: 'sh2', zone: 'EU' });
" >/dev/null

msh "$name-mongos" "$script"

# With the default script, also stop sh3 and check how mt.pool() shows a shard
# that cannot be reached (test/shard-down.js).
if [ $# -lt 3 ]; then
  docker stop "$name-sh3" >/dev/null
  msh "$name-mongos" test/shard-down.js
fi
