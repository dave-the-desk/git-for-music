#!/bin/bash

# Opens two isolated Chrome sessions for side-by-side multi-user testing.
# Usage:
#   ./open-two-chrome-sessions.sh
#   ./open-two-chrome-sessions.sh http://localhost:3001

APP_URL="${1:-http://localhost:3000}"

BASE_DIR="$(pwd)/.tmp/chrome-profiles"
USER_A_DIR="$BASE_DIR/browser-a"
USER_B_DIR="$BASE_DIR/browser-b"

mkdir -p "$USER_A_DIR" "$USER_B_DIR"

open -na "Google Chrome" --args \
  --user-data-dir="$USER_A_DIR" \
  --new-window "$APP_URL"

echo "Opened Chrome session: browser-a at $APP_URL"

open -na "Google Chrome" --args \
  --user-data-dir="$USER_B_DIR" \
  --new-window "$APP_URL"

echo "Opened Chrome session: browser-b at $APP_URL"
