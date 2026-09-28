cask "md-tools" do
  version "0.1.0"

  on_macos do
    sha256 "285bd84fb09dc815e0d67a694de732c96eb930319407f62496cc826f571afae8"

    url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-darwin-arm64-v#{version}.zip"

    depends_on arch: :arm
  end
  on_linux do
    on_arm do
      sha256 "b53d295fee3c4baabd5b90fc04c2cb1a524927d7b33902318ed83c87881ceed5"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-arm64-v#{version}.zip"
    end
    on_intel do
      sha256 "677b17249947ed02f5a9d5e8ebb72d94af992294863286c89256277a96fd59cc"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-amd64-v#{version}.zip"
    end
  end

  name "md-tools"
  desc "Markdown unwrapping and Slack mrkdwn conversion CLIs"
  homepage "https://github.com/nickv2002/md-tools"

  binary "mdunwrap"
  binary "md2mkdwn"
end
