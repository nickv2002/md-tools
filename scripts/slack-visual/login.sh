#!/usr/bin/env bash
# Authenticated agent-browser session for Slack, using the Chrome Work-profile cookies.
#
#   login.sh login    reuse the saved session; only if it is gone, copy d/d-s from Chrome
#                     (the one step that prompts for the Chrome Safe Storage keychain item)
#   login.sh forget   close the browser and delete the saved session
#   login.sh <agent-browser args...>   passthrough into the same session
#
# The session is kept by agent-browser's --restore under ~/.agent-browser/sessions, outside
# the repo and never committed. It is a plaintext, long-lived Slack credential: the directory
# is locked to mode 700, and `forget` removes it. Never print or copy cookie values.
set -euo pipefail
SESSION=md-slack-verify
MIG=/Users/nick/conductor/workspaces/incident-io-migration/melbourne
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.agent-browser/sessions"
WORKSPACE=https://owner-workspace-hq.slack.com
ab() { agent-browser --session "$SESSION" --restore "$@"; }

lock_state() {
  [ -d "$STATE_DIR" ] || return 0
  chmod 700 "$STATE_DIR"
  find "$STATE_DIR" -type f -name "*${SESSION}*" -exec chmod 600 {} +
}

signed_in() {
  ab open "$WORKSPACE/messages?skip_today=1" >/dev/null 2>&1 || true
  ab wait --load networkidle >/dev/null 2>&1 || true
  ab wait 3000 >/dev/null 2>&1 || true
  case "$(ab get url 2>/dev/null)" in
    *app.slack.com/client/*|*/messages*|*/archives/*) ! ab get title 2>/dev/null | grep -qi "sign in" ;;
    *) return 1 ;;
  esac
}

inject_from_chrome() {
  local json name value
  json="$(uv run --project "$MIG" --quiet python "$HERE/slack_cookies.py")"
  ab open about:blank >/dev/null
  for name in d d-s; do
    value="$(printf '%s' "$json" | jq -j --arg n "$name" '.[] | select(.name==$n) | .value')"
    [ -n "$value" ] || { echo "cookie $name missing" >&2; exit 1; }
    ab cookies set "$name" "$value" --domain .slack.com --path / --secure --httpOnly --sameSite Lax >/dev/null
  done
  echo "copied Slack cookies from Chrome"
}

case "${1:-}" in
  login)
    if signed_in; then echo "restored saved session (no keychain read)"
    else
      inject_from_chrome
      signed_in || { echo "Slack rejected the cookies; sign in to Slack in the Chrome Work profile and retry" >&2; exit 1; }
      echo "signed in"
    fi
    lock_state ;;
  forget)
    agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
    find "$STATE_DIR" -type f -name "*${SESSION}*" -delete 2>/dev/null || true
    echo "closed and forgot the saved session" ;;
  *) ab "$@"; lock_state ;;
esac
