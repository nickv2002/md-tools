#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: render-cask.sh VERSION DARWIN_ARM64_SHA LINUX_AMD64_SHA LINUX_ARM64_SHA" >&2
  exit 2
fi

version=$1
mac_sha=$2
amd_sha=$3
arm_sha=$4
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

for hash in "$mac_sha" "$amd_sha" "$arm_sha"; do
  if [[ ! $hash =~ ^[0-9a-f]{64}$ ]]; then
    echo "invalid SHA-256 digest" >&2
    exit 2
  fi
done
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid version" >&2
  exit 2
fi

cat > "$root/Casks/md-tools.rb" <<CASK
cask "md-tools" do
  version "$version"

  on_macos do
    depends_on arch: :arm
    sha256 "$mac_sha"
    url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-darwin-arm64-v#{version}.zip"
  end

  on_linux do
    on_intel do
      sha256 "$amd_sha"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-amd64-v#{version}.zip"
    end
    on_arm do
      sha256 "$arm_sha"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-arm64-v#{version}.zip"
    end
  end

  name "md-tools"
  desc "Markdown unwrapping and Slack mrkdwn conversion CLIs"
  homepage "https://github.com/nickv2002/md-tools"

  binary "mdunwrap"
  binary "md2mkdwn"
end
CASK
