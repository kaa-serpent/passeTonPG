#!/usr/bin/env bash
# Compatibility entrypoint: tiny consumes GitHub releases instead of compiling Git.
set -euo pipefail
exec bash "$(dirname "$(readlink -f "$0")")/deploy-docker.sh" "$@"
