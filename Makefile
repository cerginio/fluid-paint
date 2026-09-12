NPM ?= npm
NPX ?= npx
NETLIFY ?= netlify
NETLIFY_FLAGS ?=

.DEFAULT_GOAL := help

.PHONY: help setup install browsers dev build clean lint test test-fast \
	test-browser test-golden test-golden-record test-golden-dist verify ci \
	deploy-preview deploy-prod

help:
	@echo "Fluid Paint development targets"
	@echo ""
	@echo "  make setup               Install locked dependencies and Chromium"
	@echo "  make install             Recreate node_modules/ from the lockfile"
	@echo "  make browsers            Install the Playwright Chromium binary"
	@echo "  make dev                 Build, serve, and watch at http://localhost:3000"
	@echo "  make build               Create the production site in dist/"
	@echo "  make clean               Remove dist/"
	@echo "  make lint                Check shader portability rules"
	@echo "  make test-fast           Run deterministic Node-based checks"
	@echo "  make test-browser        Run headless Chromium/WebGL checks"
	@echo "  make test                Run fast and browser checks"
	@echo "  make verify              Run the release test suite and production build"
	@echo "  make test-golden         Compare source output with golden baselines"
	@echo "  make test-golden-dist    Build and compare dist/ with golden baselines"
	@echo "  make test-golden-record  Replace golden baselines after visual review"
	@echo "  make ci                  Set up, test, and build in a clean CI job"
	@echo "  make deploy-preview      Verify and create a Netlify draft deploy"
	@echo "  make deploy-prod         Verify and deploy to Netlify production"
	@echo ""
	@echo "See docs/SDLC.md for prerequisites, test scope, CI, and release guidance."

setup:
	$(MAKE) install
	$(MAKE) browsers

install:
	$(NPM) ci

browsers:
	$(NPX) playwright install chromium

dev:
	$(NPM) run dev

build:
	$(NPM) run build

clean:
	$(NPM) run clean

lint:
	$(NPM) run lint:shaders

test-fast:
	$(NPM) run lint:shaders
	$(NPM) run test:color
	$(NPM) run test:timing
	$(NPM) run test:tilecraft

test-browser:
	$(NPM) run test:live-gpu
	$(NPM) run test:tilecraft:gpu
	$(NPM) run test:story-ui
	$(NPM) run test:bake

test:
	$(MAKE) test-fast
	$(MAKE) test-browser

test-golden:
	$(NPM) run test:golden

test-golden-record:
	$(NPM) run test:golden:record

test-golden-dist: build
	$(NPM) run test:golden:dist

verify:
	$(MAKE) test
	$(MAKE) build

ci:
	$(MAKE) setup
	$(MAKE) verify

deploy-preview: verify
	$(NETLIFY) deploy --dir=dist $(NETLIFY_FLAGS)

deploy-prod: verify
	$(NETLIFY) deploy --dir=dist --prod $(NETLIFY_FLAGS)
