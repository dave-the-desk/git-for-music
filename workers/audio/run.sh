#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

IMAGE_NAME="${AUDIO_WORKER_IMAGE:-git-for-music-audio-worker}"
CONTAINER_NAME="${AUDIO_WORKER_CONTAINER_NAME:-audio-worker}"
ENV_FILE="${AUDIO_WORKER_ENV_FILE:-$SCRIPT_DIR/.env.example}"
HOST_PUBLIC_DIR="${AUDIO_WORKER_HOST_PUBLIC_DIR:-$REPO_ROOT/apps/web/public}"
CONTAINER_PUBLIC_DIR="${AUDIO_WORKER_CONTAINER_PUBLIC_DIR:-/data/public}"
DATABASE_URL="${AUDIO_WORKER_DATABASE_URL:-postgresql://postgres:postgres@host.docker.internal:5432/git_for_music}"

docker run --rm \
  --name "$CONTAINER_NAME" \
  --env-file "$ENV_FILE" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e WEB_PUBLIC_DIR="$CONTAINER_PUBLIC_DIR" \
  -v "$HOST_PUBLIC_DIR:$CONTAINER_PUBLIC_DIR" \
  "$IMAGE_NAME"
