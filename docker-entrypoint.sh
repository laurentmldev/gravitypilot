#!/bin/sh
# The golden book lives in a directory mounted from the host. Make sure the
# unprivileged "node" user can write to it; the server then drops root.
set -e
DATA_DIR="$(dirname "${GOLDENBOOK_FILE:-/app/data/goldenbook.txt}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
fi
# server.js switches to the RUN_AS user before serving anything.
exec "$@"
