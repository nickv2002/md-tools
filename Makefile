.PHONY: help build test lint check fuzz ci-status release next-version clean

GO_PACKAGES := ./...
BIN_DIR := bin
VERSION ?=
FUZZTIME ?= 10s
FUZZ_WORKERS ?= 2

help: ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

build: ## Build both CLIs into ./bin
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -o $(BIN_DIR)/mdunwrap ./cmd/mdunwrap
	CGO_ENABLED=0 go build -o $(BIN_DIR)/md2mkdwn ./cmd/md2mkdwn

test: ## Run tests
	go test $(GO_PACKAGES)

lint: ## gofmt + go vet (same as CI)
	@test -z "$$(gofmt -l cmd internal)" || { gofmt -l cmd internal; echo "gofmt needed" >&2; exit 1; }
	go vet $(GO_PACKAGES)

check: lint test ## Everything CI runs locally

# Fuzzing saturates every core by default. Cap both the workers and the Go
# scheduler, and run at low priority so the machine stays quiet.
fuzz: ## Fuzz the converter on 2 cores, low priority: make fuzz FUZZTIME=30s
	GOMAXPROCS=$(FUZZ_WORKERS) nice -n 19 go test ./internal/slack -run '^$$' -fuzz FuzzConvert -fuzztime $(FUZZTIME) -parallel $(FUZZ_WORKERS)

ci-status: ## Show CI runs for HEAD (release only after this is green)
	gh run list --branch main --commit "$$(git rev-parse HEAD)" --limit 5

next-version: ## Print latest tag
	@git describe --tags --abbrev=0 --match 'v*'

# Full pipeline: tests, cross-build, Developer ID sign, Apple notarization,
# cask update + commit, tag, push, GitHub release. Needs a clean, pushed main
# with green CI, 1Password unlocked, and the Developer ID cert in the keychain.
release: ## Sign, notarize, tag, push, publish: make release VERSION=v0.1.2
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=vX.Y.Z" >&2; exit 2; }
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "push main first" >&2; exit 1; }
	$(MAKE) check
	scripts/release.sh $(VERSION)

clean: ## Remove ./bin (never touches dist/, which holds release artifacts)
	rm -rf $(BIN_DIR)
