#!/bin/bash
# Generates a changelog section for <tag> from the commits since <prev-tag>
# (or the full history when there is no previous tag), prepends it to
# CHANGELOG.md, and writes the same section body to <notes-file> for use as the
# GitHub release body. Homebrew cask bumps are left out.
#
# Usage: scripts/changelog.sh <tag> [prev-tag] [end-ref] [notes-file]
#   end-ref defaults to HEAD and is used to backfill older tags.
set -euo pipefail

tag="${1:?usage: changelog.sh <tag> [prev-tag] [end-ref] [notes-file]}"
prev_tag="${2:-}"
end_ref="${3:-HEAD}"
notes_file="${4:-}"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

range="$end_ref"
if [[ -n "$prev_tag" ]]; then
  range="${prev_tag}..${end_ref}"
fi

if [[ "$end_ref" == "HEAD" ]]; then
  date_str=$(date +%Y-%m-%d)
else
  date_str=$(git log -1 --format=%cs "$end_ref")
fi

section=$(mktemp)
{
  echo "## ${tag} — ${date_str}"
  echo
  git log "$range" --no-merges --pretty=format:'%s' | grep -v '^Update Homebrew cask' | sed 's/^/- /' || true
} > "$section"

if [[ ! -f CHANGELOG.md ]]; then
  printf '# Changelog\n\n' > CHANGELOG.md
fi

tmp_file=$(mktemp)
{
  head -n 2 CHANGELOG.md
  cat "$section"
  echo
  tail -n +3 CHANGELOG.md
} > "$tmp_file"
mv "$tmp_file" CHANGELOG.md

if [[ -n "$notes_file" ]]; then
  mkdir -p "$(dirname "$notes_file")"
  cp "$section" "$notes_file"
fi
rm -f "$section"

echo "==> changelog section for ${tag} prepended to CHANGELOG.md${notes_file:+ and written to $notes_file}"
