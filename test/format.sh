#!/usr/bin/env bash
# Run test/format.js (no database) with the shell from a mongo image.
#
#   test/format.sh mongo:4.0              # legacy mongo shell
#   test/format.sh mongo:7.0              # mongosh
#   MONGO_SHELL=mongo test/format.sh mongo:5.0
#
# MONGOTAB_LANG / MONGOTAB_TZ are passed through when set.
set -euo pipefail

image=${1:?usage: test/format.sh <mongo image>}
root=$(cd "$(dirname "$0")/.." && pwd)
shell=${MONGO_SHELL:-$(docker run --rm --entrypoint sh "$image" -c 'command -v mongosh >/dev/null && echo mongosh || echo mongo')}

docker run --rm -v "$root":/w -w /w -e MONGOTAB_LANG -e MONGOTAB_TZ \
  --entrypoint "$shell" "$image" --nodb --quiet test/format.js
