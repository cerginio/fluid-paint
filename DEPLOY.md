# Deploy — fluid-paint

The full setup, test, CI, release, rollback, and operational guidance is in
[`docs/SDLC.md`](docs/SDLC.md). The Make targets below verify the source before
uploading the generated `dist/` artifact.

One-time setup (per machine):
```
npm install -g netlify-cli
netlify login
```

You can skip the interactive link step for a one-off command by specifying the existing site:
netlify deploy --build --prod --site=fluid-paint.netlify.app

Link this repo to its Netlify site (first time only, run from repo root):
```
netlify link
```
Choose the existing `fluid-paint` site (`https://fluid-paint.netlify.app/`).



## Deploy a preview (draft)

```
make deploy-preview
```

The direct CLI equivalent (without the Makefile verification gate) is:
```
npm run build
netlify deploy --dir=dist
```

Check the draft URL printed in the terminal before going further.

## Deploy to production

```
make deploy-prod
```

The direct CLI equivalent is `netlify deploy --dir=dist --prod` after building
and testing.

## Notes for this repo

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `24`
- Gulp derives the shader registry from the engine/app manifests before
  scripts, writes ignored `dist/.build/shader-registry.js`, and prepends it to
  `dist/bundle.js`. GLSL text is preserved, not minified. Missing/blank files
  and physical/logical key collisions stop the build with the source path.
- Shader trees are also copied into `dist` for compatibility, but bundled
  Paint uses the registry and makes **zero** `.frag`/`.vert` requests. A broken
  runtime registry produces an initialization alert, never an XHR fallback.
- Before publishing, run `npm run test:shader-bundle` and
  `npm run test:shader-bundle:gpu` (included in `make verify`). The browser
  runner builds production, blocks shader routes, exercises WebGL1/2 draw,
  resize and PNG save, source examples, errors and real dev watch, then stops
  its servers and verifies ports free. Evidence is in the printed Temp path.

## CI / non-interactive deploy

```
NETLIFY_AUTH_TOKEN=<token> make deploy-prod NETLIFY_FLAGS="--site=<SITE_ID>"
```

Token: Netlify → User settings → Applications → Personal access tokens.
Site ID: found in `.netlify/state.json` after linking, or in Site settings
→ General → Site details.
