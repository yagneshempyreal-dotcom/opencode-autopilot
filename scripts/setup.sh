#!/usr/bin/env bash
# opencode-openauto setup — registers the plugin and the OpenAuto Router
# provider in ~/.config/opencode/opencode.json so the model picker lists
# OpenAuto on the very first start of opencode.
#
# Usage:
#   ./scripts/setup.sh             # default port 4317
#   ./scripts/setup.sh --port=4318 # custom port
#
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$DIR/dist/cli/index.js" setup "$@"
