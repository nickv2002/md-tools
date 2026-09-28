cask "md-tools" do
  version "0.1.2"

  on_macos do
    sha256 "a5017c0e0ca9d448b39f41f448169d3088530cc8d717aa260a0416acd124d464"

    url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-darwin-arm64-v#{version}.zip"

    depends_on arch: :arm64
  end
  on_linux do
    on_arm do
      sha256 "e2fa18f65a47f5316a721fff7d417ea135390cac3ee52b7188e827c59cfdf4bb"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-arm64-v#{version}.zip"
    end
    on_intel do
      sha256 "4a44f7b3bcb21b43b99b2476bc683b66507821f5afe73f37acaf8227ba7ab1d9"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-amd64-v#{version}.zip"
    end
  end

  name "md-tools"
  desc "Markdown unwrapping and Slack mrkdwn conversion CLIs"
  homepage "https://github.com/nickv2002/md-tools"

  binary "mdunwrap"
  binary "md2mkdwn"
end
