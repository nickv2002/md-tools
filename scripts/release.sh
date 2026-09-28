#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/release.sh vMAJOR.MINOR.PATCH" >&2
  exit 2
fi
tag=$1
version=${tag#v}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if [[ $(uname -s) != Darwin || $(uname -m) != arm64 ]]; then
  echo "release must run on macOS ARM64" >&2
  exit 1
fi
if [[ $(git branch --show-current) != main || -n $(git status --porcelain) ]]; then
  echo "release requires a clean main branch" >&2
  exit 1
fi
if git rev-parse --verify "$tag" >/dev/null 2>&1 || gh release view "$tag" >/dev/null 2>&1; then
  echo "tag or release already exists: $tag" >&2
  exit 1
fi
for tool in go zip unzip jq op gh codesign xcrun shasum; do
  command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }
done

dist="$root/dist/$tag"
if [[ -e $dist ]]; then
  echo "refusing to overwrite $dist" >&2
  exit 1
fi
mkdir -p "$dist"
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
chmod 700 "$temporary"

echo "==> test"
go test ./...

identity='Developer ID Application: Nicholas Vance (3D9SMH4RWM)'
for target in darwin/arm64 linux/amd64 linux/arm64; do
  os=${target%/*}
  arch=${target#*/}
  stage="$temporary/$os-$arch"
  mkdir -p "$stage"
  echo "==> build $target"
  for command in mdunwrap md2mkdwn; do
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build \
      -trimpath -ldflags "-s -w -X github.com/nickv2002/md-tools/internal/cli.Version=$version" \
      -o "$stage/$command" "./cmd/$command"
  done
  if [[ $os == darwin ]]; then
    for command in mdunwrap md2mkdwn; do
      codesign --force --options runtime --timestamp --sign "$identity" "$stage/$command"
      codesign --verify --strict --verbose=2 "$stage/$command"
    done
  fi
  archive="$dist/md-tools-$os-$arch-$tag.zip"
  zip -q -X -j "$archive" "$stage/mdunwrap" "$stage/md2mkdwn"
  unzip -tq "$archive"
done

op_account='nickfam.1password.com'
op_vault='Private'
op_item='App Store Connect API Key File'
item_ref="op://$op_vault/$op_item"
echo "==> get notarization credentials from 1Password"
key_name=$(op item get "$op_item" --vault "$op_vault" --account "$op_account" --format json | jq -er '.files[0].name')
if [[ ! $key_name =~ ^AuthKey_([A-Za-z0-9]+)\.p8$ ]]; then
  echo "unexpected App Store Connect key filename" >&2
  exit 1
fi
key_id=${BASH_REMATCH[1]}
issuer_id=$(op read "$item_ref/issuer id" --account "$op_account")
key_path="$temporary/$key_name"
op read "$item_ref/$key_name" --account "$op_account" --out-file "$key_path" >/dev/null
chmod 600 "$key_path"

mac_zip="$dist/md-tools-darwin-arm64-$tag.zip"
echo "==> notarize final macOS ZIP"
xcrun notarytool submit "$mac_zip" --key "$key_path" --key-id "$key_id" \
  --issuer "$issuer_id" --wait --output-format json > "$temporary/notary-result.json"
jq -e '.status == "Accepted"' "$temporary/notary-result.json" >/dev/null
submission_id=$(jq -er '.id' "$temporary/notary-result.json")
xcrun notarytool log "$submission_id" --key "$key_path" --key-id "$key_id" \
  --issuer "$issuer_id" "$dist/notarization-log.json"
jq -e '.status == "Accepted"' "$dist/notarization-log.json" >/dev/null

echo "==> verify macOS ZIP after notarization"
verify_dir="$temporary/verify-mac"
mkdir -p "$verify_dir"
unzip -q "$mac_zip" -d "$verify_dir"
for command in mdunwrap md2mkdwn; do
  codesign --verify --strict --verbose=2 "$verify_dir/$command"
  "$verify_dir/$command" --version
done

(cd "$dist" && shasum -a 256 md-tools-*.zip > checksums.txt)
mac_sha=$(shasum -a 256 "$mac_zip" | cut -d ' ' -f 1)
amd_sha=$(shasum -a 256 "$dist/md-tools-linux-amd64-$tag.zip" | cut -d ' ' -f 1)
arm_sha=$(shasum -a 256 "$dist/md-tools-linux-arm64-$tag.zip" | cut -d ' ' -f 1)

echo "==> tag and create draft release"
git tag "$tag"
git push origin main "$tag"
gh release create "$tag" "$dist"/md-tools-*.zip "$dist/checksums.txt" \
  "$dist/notarization-log.json" --draft --title "$tag" \
  --notes "Signed and notarized macOS ARM64 and self-contained Linux AMD64/ARM64 CLI ZIPs."

echo "==> update Homebrew cask"
"$root/scripts/render-cask.sh" "$version" "$mac_sha" "$amd_sha" "$arm_sha"
git add Casks/md-tools.rb
git -c commit.gpgsign=false commit -m "Update Homebrew cask for $tag"
git push origin main

echo "==> publish release"
gh release edit "$tag" --draft=false
echo "Published $tag: https://github.com/nickv2002/md-tools/releases/tag/$tag"
