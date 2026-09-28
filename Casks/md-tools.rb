cask "md-tools" do
  version "0.1.3"

  on_macos do
    sha256 "21d9932c8aaf2729c83c8aef6b309653b7effb02c1476f8024c6351544af8bda"

    url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-darwin-arm64-v#{version}.zip"

    depends_on arch: :arm64
  end
  on_linux do
    on_arm do
      sha256 "814ed08c11b1e2ba296ef7e9c1859c0d47cebd923c66831cc095c42863e2d44c"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-arm64-v#{version}.zip"
    end
    on_intel do
      sha256 "090abb810cd2f03785da30bcc5f25348dd5030c1bc6e080d92402f6c9fc274ad"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-amd64-v#{version}.zip"
    end
  end

  name "md-tools"
  desc "Markdown unwrapping and Slack mrkdwn conversion CLIs"
  homepage "https://github.com/nickv2002/md-tools"

  binary "mdunwrap"
  binary "md2mkdwn"
end
