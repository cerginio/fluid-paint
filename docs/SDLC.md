# Fluid Paint software development lifecycle

This document is the operational guide for developing, testing, building, and
deploying Fluid Paint. Commands are run from the repository root.

## Lifecycle at a glance

1. Install Node.js 24, npm, GNU Make, and the Netlify CLI when deploying.
2. Run `make setup` after cloning or whenever the lockfile changes.
3. Develop with `make dev` and test the affected behavior on a WebGL-capable
   browser and, for rendering changes, representative physical devices.
4. Run `make test-fast` during development and `make verify` before review or
   release.
5. Review the generated `dist/` site locally or in a Netlify draft deploy.
6. Merge reviewed changes and deploy the exact verified tree with
   `make deploy-prod`.

GNU Make is a convenience layer; build and test targets delegate to the npm
scripts in `package.json`, while setup and deployment wrap their respective
CLIs. On Windows, use Make through Git Bash, WSL, Chocolatey, Scoop, or use the
underlying commands listed below.

## Prerequisites

- **Node.js 24 and npm.** Netlify is pinned to Node 24 in `netlify.toml`. Using
  the same major locally avoids environment drift.
- **GNU Make** for the short commands in this guide. It is optional if npm
  commands are used directly.
- **Chromium managed by Playwright** for browser and GPU tests.
- **A WebGL-capable browser/GPU** for interactive verification. Headless tests
  use Chromium/SwiftShader where configured, but cannot reproduce every mobile
  driver.
- **Netlify CLI and account access** only for deployment.

Check the basic toolchain with `node --version`, `npm --version`, and
`make --version`.

## First-time setup

```sh
git clone https://github.com/cerginio/fluid-paint.git
cd fluid-paint
make setup
```

`make setup` runs `npm ci` and `npx playwright install chromium`. `npm ci` uses
the committed `package-lock.json`, removes an existing `node_modules/`, and
recreates a reproducible dependency tree. Use `npm install <package> --save-dev`
only when intentionally changing dependencies; review and commit both
`package.json` and `package-lock.json`.

On a minimal Linux runner, Playwright may also require operating-system
packages. Provision them in the runner image or run
`npx playwright install --with-deps chromium` with appropriate privileges.

## Local development

```sh
make dev
```

This creates a development build in `dist/`, serves it at
`http://localhost:3000`, and watches HTML, CSS, JavaScript, and shader sources.
Stop it with Ctrl+C. The server binds to localhost and is intended for
development, not production hosting.

Important source areas are:

- `index.html` and `app/`: application shell, UI, layout, and UI shaders.
- `paint.js` and `paint-setup.js`: application behavior and composition.
- `fluid-engine/`: reusable simulation, renderer, brush, GL wrapper, and engine
  shaders.
- `debug/`: deterministic checks, browser/GPU tests, probes, and diagnostics.
- `examples/minimal/`: source-only engine integration example. It is
  intentionally not copied into `dist/`.
- `docs/`: architecture, API, device verification, specifications, and test
  contracts.

The project uses ordered browser globals rather than an ES module graph. When a
JavaScript source file is added, removed, or reordered, update `paths.js` in
`gulpfile.js`; otherwise it will not be included correctly in `bundle.js`.
Shader and stylesheet output paths must continue matching the literal paths
used by the application.

## Build and artifacts

```sh
make build
# npm equivalent: npm run build
```

The production build always cleans and recreates `dist/`. Gulp:

- concatenates JavaScript in declared dependency order into minified
  `dist/bundle.js`;
- processes `app/layout.css` with Autoprefixer and cssnano;
- minifies `index.html`, replaces local script tags with `bundle.js`, and copies
  it to `dist/`;
- preserves the `app/shaders/` and `fluid-engine/shaders/` directory layouts;
- copies `LICENSE`.

`dist/`, `node_modules/`, and local `.netlify/` state are generated and ignored
by Git. Do not hand-edit or commit them. Use `make clean` to remove `dist/`.

To inspect the production artifact with a local static server, run:

```sh
npx http-server dist
```

Any static server is suitable. Confirm the browser console and Network panel
contain no script, stylesheet, or shader loading errors.

## Test strategy

### Fast deterministic checks

Run `make test-fast` for the normal inner loop. It executes:

| npm command | Coverage |
| --- | --- |
| `npm run lint:shaders` | WebGL shader precision and texture portability rules |
| `npm run test:color` | RYB/RGB conversion, composition, cube corners, and CSS color formatting |
| `npm run test:timing` | Stroke timing across frame rates, overload, resume, taps, and endpoints |
| `npm run test:tilecraft` | Story stroke mapping, pacing, navigation, stacking, and cancellation |

These tests do not require a browser and return a non-zero exit status on a
failure.

### Browser and GPU checks

Run `make test-browser` after setup. It executes the following sequentially;
the repository's browser lock prevents competing Chromium GPU runs.

| npm command | Coverage |
| --- | --- |
| `npm run test:live-gpu` | Live engine behavior in headless Chromium/WebGL |
| `npm run test:tilecraft:gpu` | Accelerated story playback through the real GPU path |
| `npm run test:story-ui` | Story import, controls, navigation, registry, and mobile layout |
| `npm run test:bake` | GPU-backed bake behavior |

Use `make test` for both the fast and browser tiers. Use `make verify` as the
pre-review and pre-release gate; it runs all of those tests and then creates a
fresh production build.

### Golden rendering checks

- `make test-golden` compares source rendering with
  `debug/golden-baseline.json`.
- `make test-golden-dist` builds and compares the production artifact.
- `make test-golden-record` intentionally replaces the baseline.

Golden tests are not part of `make verify` today. The current baseline is known
to report screen-hash drift after the pigment-black rendering change, while the
paint hashes remain stable; this is documented in `package.json` and
`docs/GOLDEN-IMAGES.md`. Treat results as review evidence, not a green release
gate, until the baseline has been visually reviewed and approved.

Never re-record merely to make a failure disappear. Inspect the rendered
output, confirm the change is intended, record once, review the baseline diff,
and explain the visual change in the commit or pull request.

### Manual and physical-device checks

Headless Chromium is necessary but not sufficient for this WebGL application.
For changes to shaders, canvas sizing, pointer input, viewport behavior,
performance, or mobile layout:

1. Exercise drawing, resize/rotation, zoom/pan, undo/redo, color selection, and
   Story playback in a desktop browser.
2. Check console errors, failed shader fetches/compilation, and visible artifacts.
3. Test affected mobile behavior on a representative physical device and GPU.
4. Follow `docs/DEVICE-VERIFICATION.md` for LAN/USB debugging and
   `docs/MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md` for GPU-specific diagnostics.

Record the devices, browsers, and scenarios tested in the pull request.

## Change, review, and release workflow

Keep changes focused and make the corresponding tests and documentation part of
the same change. Before requesting review:

```sh
make verify
git status --short
git diff --check
```

Review should cover source behavior, tests, generated build success, shader and
asset paths, browser console output, and manual/device evidence where relevant.
Dependency changes should additionally review the lockfile and `npm audit`
output; do not apply forced major-version audit fixes without understanding the
compatibility impact.

The repository does not currently contain a hosted CI workflow. A future CI job
should use the same lifecycle entry point:

```sh
make ci
```

`make ci` performs a locked install, installs Chromium, runs the complete
non-golden suite, and builds `dist/`. Cache npm's download cache and Playwright
browsers if desired, but never cache `node_modules/` in place of `npm ci`.
Archive `dist/` from the successful build if a later deployment stage must
publish exactly the tested artifact.

Release versions and tags are currently maintainer decisions; no automatic
versioning or changelog generator is configured. If a release is tagged, tag
the reviewed commit whose verification and deployment evidence is retained.

## Netlify deployment

Netlify reads `netlify.toml`, runs `npm run build` with Node 24, and publishes
`dist/`. Install and authenticate the CLI once:

```sh
npm install --global netlify-cli
netlify login
netlify link
```

During `netlify link`, select the existing `fluid-paint` site. Local link state
is saved under ignored `.netlify/`.

Create a draft URL first:

```sh
make deploy-preview
```

Open the printed URL and smoke-test loading, drawing, UI controls, Story
playback when affected, browser console output, and shader/network requests.
Then deploy the verified tree to production:

```sh
make deploy-prod
```

Both targets run `make verify` before publishing. They upload the generated
`dist/` directly, avoiding a second remote build of different source state.
Production deployment changes the public site and requires authorized Netlify
credentials.

For non-interactive deployment, keep credentials in the CI secret store:

```sh
NETLIFY_AUTH_TOKEN=<token> \
  make deploy-prod NETLIFY_FLAGS="--site=<site-id>"
```

Never commit the token, site-local state, or secret-bearing logs. Netlify also
accepts the linked site locally. See `DEPLOY.md` for the compact command
reference.

If production validation fails, stop further releases, capture the failing
deployment and symptoms, and restore a known-good deploy through Netlify's
deploy history. Then fix forward from source and repeat `make verify` plus the
draft-deploy smoke test. Rebuilding an old unreviewed working tree is less
reliable than restoring the previously published immutable deploy.

## Operational and maintenance checks

- Runtime diagnostics are browser-side; check the console, network requests,
  shader compilation, and device diagnostics described in `debug/` and the
  device guide. No separate backend, database, migration, or runtime secret is
  part of this repository.
- Review dependency updates intentionally, run `npm audit`, and rerun
  `make verify`. Rendering-tool updates can change headless GPU behavior, so
  compare manual output too.
- Keep `netlify.toml`, this guide, the Makefile, npm scripts, and Node major
  version aligned whenever the toolchain changes.
- Preserve third-party notices and `LICENSE`; review licensing before adding or
  replacing vendored code under `lib/` or copied components.

## Troubleshooting

- **`make` is unavailable:** run the npm command shown in this document, or
  install GNU Make/enter WSL or Git Bash.
- **Chromium executable is missing:** run `make browsers`.
- **Chromium lacks Linux libraries:** provision the runner dependencies or use
  `npx playwright install --with-deps chromium`.
- **A GPU test says the browser lock is held:** let the other test finish. If no
  browser test is running, inspect the lock details before removing a genuinely
  stale lock; see `debug/browser-lock.js`.
- **The built page is blank or shaders 404:** rebuild from a clean tree and
  verify the mirrored shader directories and `gulpfile.js` source lists.
- **Port 3000 is occupied:** stop the conflicting process; the Gulp development
  server currently has a fixed port.
- **Golden tests fail:** read `docs/GOLDEN-IMAGES.md` and the known-baseline note
  above before deciding whether the change is a regression.
- **Netlify cannot find the site:** run `netlify link`, or pass
  `NETLIFY_FLAGS="--site=<site-id>"`.
