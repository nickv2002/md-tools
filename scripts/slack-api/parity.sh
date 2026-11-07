#!/usr/bin/env bash
# Differential test of the converter against the real Slack API (see
# internal/slack/parity_slackapi_test.go). Posts short messages to the user's own DM
# with a Slack bot (chat:write) and deletes each one straight after reading back how Slack
# parsed it. The token is held in a shell variable only; never print it.
#   scripts/slack-api/parity.sh                      # 60 generated cases, seed 1
#   SLACK_PARITY_N=200 SLACK_PARITY_SEED=7 scripts/slack-api/parity.sh
#   SLACK_PARITY_RAW=$'*_x._*\n@@\n*_x_*' SLACK_PARITY_RUN=TestSlackRawProbe scripts/slack-api/parity.sh   # post mrkdwn verbatim
#   SLACK_PARITY_INPUT='foo**bar**' scripts/slack-api/parity.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
# Required environment: SLACK_BOT_TOKEN (bot token with chat:write) and SLACK_TEST_USER
# (the Slack user ID to DM). Neither is stored in this repo.
: "${SLACK_BOT_TOKEN:?set SLACK_BOT_TOKEN to a bot token with chat:write}"
: "${SLACK_TEST_USER:?set SLACK_TEST_USER to the Slack user ID to DM}"
export SLACK_BOT_TOKEN SLACK_TEST_USER
GOMAXPROCS=2 nice -n 19 go test -tags slackapi ./internal/slack -run "${SLACK_PARITY_RUN:-TestSlackParity}" -count=1 -v -timeout 30m
