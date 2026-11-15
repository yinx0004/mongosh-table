#!/usr/bin/env bash
# Run test/compat.js in Docker against a throwaway single-node replica set.
#
#   test/run.sh <mongodb image> [mongosh image]
#   test/run.sh mongo:7.0                 # server 7.0, mongosh bundled in mongo:7.0
#   test/run.sh mongo:4.4 mongo:6.0.4     # server 4.4, mongosh 1.8.0
#
# The mongosh image only supplies the client; mongo:4.4 has no mongosh, so
# pass a newer image as the second argument for it.
set -euo pipefail

server=${1:?usage: test/run.sh <mongodb image> [mongosh image]}
client=${2:-$server}
root=$(cd "$(dirname "$0")/.." && pwd)
name=mongotab-test-$$
net=$name-net

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
docker run -d --name "$name" --network "$net" "$server" mongod --replSet rs0 --bind_ip_all >/dev/null

uri="mongodb://$name:27017/test?directConnection=true"
msh() { docker run --rm -i --network "$net" -v "$root":/w -w /w "$client" mongosh --quiet "$uri" "$@"; }

wait_for() {
  for _ in $(seq 1 60); do
    [ "$(msh --eval "$1" 2>/dev/null | tail -n 1)" = true ] && return 0
    sleep 1
  done
  echo "timed out waiting for: $1" >&2
  docker logs "$name" 2>&1 | tail -n 20 >&2
  return 1
}

wait_for 'db.adminCommand({ping: 1}).ok === 1'
msh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: '$name:27017'}]}).ok" >/dev/null
wait_for 'db.hello().isWritablePrimary'

msh test/compat.js
