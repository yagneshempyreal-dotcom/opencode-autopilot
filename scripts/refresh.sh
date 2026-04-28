#!/usr/bin/env bash
# opencode-openauto refresh wrapper.
# Kills running opencode TUIs, clears the plugin / bun caches, truncates the
# autopilot log, then optionally relaunches opencode. Used after pushing new
# plugin commits so opencode picks up the new version on its next start.
#
# Usage:
#   scripts/refresh.sh              # interactive (asks before kill / launch)
#   scripts/refresh.sh --yes        # no prompts
#   scripts/refresh.sh --no-launch  # do everything except relaunch opencode
#
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$DIR/dist/cli/index.js" refresh "$@"
