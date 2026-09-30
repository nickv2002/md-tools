#!/usr/bin/env bash
# Differential test of the converter against the real Slack API (see
# internal/slack/parity_slackapi_test.go). Posts short messages to the user's own DM
# with the shared forge bot and deletes each one straight after reading back how Slack
# parsed it. The token is held in a shell variable only; never print it.
#   scripts/slack-api/parity.sh                      # 60 generated cases, seed 1
#   SLACK_PARITY_N=200 SLACK_PARITY_SEED=7 scripts/slack-api/parity.sh
#   SLACK_PARITY_INPUT='foo**bar**' scripts/slack-api/parity.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SLACK_BOT_TOKEN="$(op item get REDACTED --account REDACTED \
  --fields label=REDACTED --reveal)"
export SLACK_BOT_TOKEN SLACK_TEST_USER="${SLACK_TEST_USER:-UXXXXXXXXXX}"
GOMAXPROCS=2 nice -n 19 go test -tags slackapi ./internal/slack -run TestSlackParity -count=1 -v -timeout 30m
