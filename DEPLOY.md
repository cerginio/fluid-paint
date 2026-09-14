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
- Gulp builds this static site and copies the shader asset trees into `dist`.

## CI / non-interactive deploy

```
NETLIFY_AUTH_TOKEN=<token> make deploy-prod NETLIFY_FLAGS="--site=<SITE_ID>"
```

Token: Netlify → User settings → Applications → Personal access tokens.
Site ID: found in `.netlify/state.json` after linking, or in Site settings
→ General → Site details.
