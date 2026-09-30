#!/usr/bin/env bash
# Inject the Chrome Work-profile Slack session into an isolated agent-browser
# session, following incident-io-migration/docs/2026-08-04_browser-automation-recipe.md.
# Cookie values live only in shell variables and argv: never printed, never written to disk,
# no --restore. Usage: slack-login.sh login | logout | <agent-browser args...>
set -euo pipefail
SESSION=md-slack-verify
MIG=/Users/nick/conductor/workspaces/incident-io-migration/melbourne
ab() { agent-browser --session "$SESSION" "$@"; }

login() {
  local json name value
  json="$(uv run --project "$MIG" --quiet python "$(dirname "${BASH_SOURCE[0]}")/slack_cookies.py")"
  ab open about:blank >/dev/null
  for name in d d-s; do
    value="$(printf '%s' "$json" | jq -j --arg n "$name" '.[] | select(.name==$n) | .value')"
    [ -n "$value" ] || { echo "cookie $name missing" >&2; exit 1; }
    ab cookies set "$name" "$value" --domain .slack.com --path / --secure --httpOnly --sameSite Lax >/dev/null
    echo "injected $name (${#value} chars)"
  done
}
case "${1:-}" in
  login) login ;;
  logout) ab cookies clear >/dev/null || true; ab close >/dev/null || true; echo closed ;;
  *) ab "$@" ;;
esac
