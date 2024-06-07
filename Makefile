# See https://tech.davis-hansson.com/p/make/
SHELL := bash
.DELETE_ON_ERROR:
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := all
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --no-print-directory
BUF_VERSION ?= 1.32.2

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
SED_I := sed -E -i ''
else
SED_I := sed -E -i
endif

.PHONY: help
help: ## Describe useful make targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-30s %s\n", $$1, $$2}'

PHONY: all
all: ## Format, Lint and build (default)
	$(MAKE) build

.PHONY: format
format: node_modules
	npm run format

.PHONY: lint
lint: node_modules
	npm run lint

.PHONY: build
build: node_modules format lint
	npm run build

.PHONY: updateversion
updateversion:
ifndef VERSION
	$(error "VERSION must be set")
endif
	$(SED_I) "s/version: [0-9]+\.[0-9]+\.[0-9]+/version: $(BUF_VERSION)/g" action.yml
	$(SED_I) "s/version: [0-9]+\.[0-9]+\.[0-9]+/version: $(BUF_VERSION)/g" README.md
	$(SED_I) "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$(VERSION)\"/g" package.json
	$(SED_I) "s/buf-action@v[0-9]+\.[0-9]+\.[0-9]+/buf-action@v$(VERSION)/g" README.md
	$(SED_I) "s/buf-action@v[0-9]+\.[0-9]+\.[0-9]+/buf-action@v$(VERSION)/g" examples/*.yaml
	$(SED_I) "s/version: [0-9]+\.[0-9]+\.[0-9]+/version: $(BUF_VERSION)/g" examples/*.yaml

.PHONY: generate
generate: node_modules ## Regenerate licenses
	npm run generate

.PHONY: checkgenerate
checkgenerate:
	@# Used in CI to verify that `make generate` doesn't produce a diff.
	test -z "$$(git status --porcelain | tee /dev/stderr)"

node_modules: package-lock.json
	npm ci
