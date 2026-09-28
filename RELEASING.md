# Releasing

Releases are prepared on Nicholas's macOS ARM64 machine. CI has no signing
certificate or notarization credentials. The script requires Go, `zip`, `jq`,
GitHub CLI, 1Password CLI, Xcode command-line tools, and the Developer ID
Application certificate in the login keychain.

From a clean `main` branch after CI passes:

```bash
scripts/release.sh v0.1.0
```

The script tests, cross-builds with `CGO_ENABLED=0`, signs both Mac tools,
notarizes the final Mac ZIP, checks signatures and archives, creates a draft
GitHub release with three ZIPs and `checksums.txt`, updates the cask in this
same repository, then publishes the release. It retrieves the App Store Connect
API key from the same 1Password item used by `transgui`; it never commits the
key or passes it to CI. Review the resulting release and run a fresh Homebrew
install and quarantined-download test before removing a previous installation.

Because ZIPs and standalone CLIs cannot be stapled, notarization is verified
via the online Apple ticket; an offline first run is not guaranteed to pass
Gatekeeper.
