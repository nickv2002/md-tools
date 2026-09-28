cask "md-tools" do
  version "0.1.1"

  on_macos do
    sha256 "f15e70a836c5cb4d671592f693dbb08ab5cbd2a852af3644bfb44a6e845a3cda"

    url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-darwin-arm64-v#{version}.zip"

    depends_on arch: :arm64
  end
  on_linux do
    on_arm do
      sha256 "052565c8973a1fa5128d732718b0202cadcb3256c4b39cd53eead80fde1c9c91"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-arm64-v#{version}.zip"
    end
    on_intel do
      sha256 "5dfcc6fd35d7ea9afd8e1b4e193bcc1cda4a7aa91f12853f4312a2929aa100ac"
      url "https://github.com/nickv2002/md-tools/releases/download/v#{version}/md-tools-linux-amd64-v#{version}.zip"
    end
  end

  name "md-tools"
  desc "Markdown unwrapping and Slack mrkdwn conversion CLIs"
  homepage "https://github.com/nickv2002/md-tools"

  binary "mdunwrap"
  binary "md2mkdwn"
end
