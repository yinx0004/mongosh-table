#!/usr/bin/env bash
# Run test/auth.js in Docker against a throwaway standalone mongod started with
# --auth: mt.users() with authentication on, logged in as root and as a user
# that may not list users.
#
#   test/auth.sh <mongodb image> [client image]
#   test/auth.sh mongo:7.0
#   test/auth.sh mongo:4.4 mongo:6.0.4          # mongosh 1.8.0
#   MONGO_SHELL=mongo test/auth.sh mongo:3.6    # legacy shell
set -euo pipefail

server=${1:?usage: test/auth.sh <mongodb image> [client image]}
client=${2:-$server}
root=$(cd "$(dirname "$0")/.." && pwd)
name=mtauth-$$
net=$name-net

shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$client" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}

cleanup() {
  docker rm -f -v "$name" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$net" >/dev/null
docker run -d --name "$name" --network "$net" "$server" mongod --auth --bind_ip_all >/dev/null

# The first user comes in through the localhost exception, so it is created
# from inside the server container with the shell that image has.
srvshell=$(docker exec "$name" sh -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')
for _ in $(seq 1 60); do
  [ "$(docker exec "$name" "$srvshell" --quiet --eval 'print(db.adminCommand({ping: 1}).ok)' 2>/dev/null | tail -n 1)" = 1 ] && break
  sleep 1
done
docker exec "$name" "$srvshell" --quiet admin --eval "db.createUser({user: 'ops', pwd: 'opspw', roles: ['root']})" >/dev/null

uri="mongodb://ops:opspw@$name:27017/admin"
[ "$shell" = mongosh ] && uri="$uri?directConnection=true"
docker run --rm -i --network "$net" -v "$root":/w -w /w --entrypoint "$shell" "$client" --quiet "$uri" --eval "var MT_HOST = '$name:27017'" test/auth.js
