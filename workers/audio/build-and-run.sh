#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

IMAGE_NAME="${AUDIO_WORKER_IMAGE:-git-for-music-audio-worker}"

docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

"$SCRIPT_DIR/run.sh"
