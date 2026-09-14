# Fluid Paint

![](http://david.li/images/paintgithub.png)

[http://david.li/paint](http://david.li/paint)

Modernized browser-based fluid painting powered by WebGL.

## Quick start

Requires Node.js 24, npm, GNU Make, and a WebGL-capable browser.

```sh
make setup
make dev
```

Open <http://localhost:3000>. Before review or release, run:

```sh
make verify
```

If GNU Make is unavailable, use `npm ci`, `npx playwright install chromium`,
`npm run dev`, and the npm test commands documented in the lifecycle guide.

## Documentation

- [Development, testing, build, CI, and deployment lifecycle](docs/SDLC.md)
- [Deployment command reference](DEPLOY.md)
- [FluidEngine API: Zero to Hero](docs/FLUID-ENGINE-API-ZERO-TO-HERO.md)
- [Device verification](docs/DEVICE-VERIFICATION.md)
- [Tilecraft embedded-vendor manifest](docs/TILECRAFT-FLUID-VENDOR.md)
