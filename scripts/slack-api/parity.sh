#!/usr/bin/env bash
# Differential test of the converter against the real Slack API (see
# internal/slack/parity_slackapi_test.go). Posts short messages to the user's own DM
# with the shared forge bot and deletes each one straight after reading back how Slack
# parsed it. The token is held in a shell variable only; never print it.
#   scripts/slack-api/parity.sh                      # 60 generated cases, seed 1
#   SLACK_PARITY_N=200 SLACK_PARITY_SEED=7 scripts/slack-api/parity.sh
#   SLACK_PARITY_RAW=$'*_x._*\n@@\n*_x_*' SLACK_PARITY_RUN=TestSlackRawProbe scripts/slack-api/parity.sh   # post mrkdwn verbatim
#   SLACK_PARITY_INPUT='foo**bar**' scripts/slack-api/parity.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SLACK_BOT_TOKEN="$(op item get jvrp4z4iunafhotlpn5fdsorsu --account owner-hq.1password.com \
  --fields label=OWNER-LOCAL-SLACK-MCP-BOT-SHARED-TOKEN --reveal)"
export SLACK_BOT_TOKEN SLACK_TEST_USER="${SLACK_TEST_USER:-U098HJD0MGS}"
GOMAXPROCS=2 nice -n 19 go test -tags slackapi ./internal/slack -run "${SLACK_PARITY_RUN:-TestSlackParity}" -count=1 -v -timeout 30m
