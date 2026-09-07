# Deploy — fluid-paint

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
npm run build
netlify deploy --dir=dist
```

Or let Netlify run the build:
```
netlify deploy --build
```

Check the draft URL printed in the terminal before going further.

## Deploy to production

```
netlify deploy --build --prod
```

## Notes for this repo

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `24`
- Gulp builds this static site and copies the shader asset trees into `dist`.

## CI / non-interactive deploy

```
NETLIFY_AUTH_TOKEN=<token> netlify deploy --build --prod --site=<SITE_ID>
```

Token: Netlify → User settings → Applications → Personal access tokens.
Site ID: found in `.netlify/state.json` after linking, or in Site settings
→ General → Site details.
