#!/usr/bin/env bash
# The legacy mongo shell (the `mongo` command in MongoDB 5.0 and earlier) is
# not supported. Check that loading mongotab.js there prints the "needs
# mongosh" message and defines nothing, instead of throwing.
#
#   test/legacy.sh mongo:4.0
set -euo pipefail

image=${1:?usage: test/legacy.sh <mongo image with the legacy mongo shell>}
root=$(cd "$(dirname "$0")/.." && pwd)

if ! out=$(docker run --rm -v "$root":/w --entrypoint mongo "$image" --nodb --quiet \
    --eval "load('/w/mongotab.js'); print('globals: ' + typeof t + ' ' + typeof g + ' ' + typeof mt + ' ' + typeof mongotab)" 2>&1); then
  echo "$out"
  echo "FAIL: load() threw in $image"
  exit 1
fi
echo "$out"

for want in 'MongoTab 需要 mongosh' 'MongoTab needs mongosh' 'globals: undefined undefined undefined undefined'; do
  if ! grep -qF "$want" <<<"$out"; then
    echo "FAIL: missing \"$want\" in $image"
    exit 1
  fi
done
echo "OK $image"
