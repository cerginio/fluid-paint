# Production release — 2026-10-16

**Статус: production deploy та HTTPS readback PASS.** Власник прийняв фазу8/UI через
`handoff:next` і прямо попросив «and then make prod deploy»; фази9–10 цим не реалізовані.

- Production: https://fluid.storytilecraft.space/?webgl=2&debug=none&diag=0&seed=41
- Deploy: [6ad2774957cb01560c91ebe8](https://app.netlify.com/projects/fluid-paint/deploys/6ad2774957cb01560c91ebe8), [immutable URL](https://6ad2774957cb01560c91ebe8--fluid-paint.netlify.app).
- Site fluid-paint, ID `79a5d98c-0ff5-47fd-b048-64d714854ff9`.
- Built revision `69cd448d611947872f08b58eefa5971167a405d1`; release `b7606642d683c177e164202aa80b8a83b4dafa2b336675f7fe6e5b04e4d83cb4`.
- Build metadata `2026-10-16T19:12:15.713Z`; artifact: 20 inventory entries.
- Closing commits: `378a840` cleanup/live document pins; `a813e6c` floating UI + acceptance;
  `69cd448` release verification aligned with current contract. This report is a later docs-only commit.
- Exact command: `node C:/nvm4w/nodejs/node_modules/netlify-cli/bin/run.js deploy --dir=dist --prod --no-build --site=79a5d98c-0ff5-47fd-b048-64d714854ff9 --json --message "Accepted PWA phase 8 cleanup and compact update popover (69cd448)"`.
  Artifact built and verified before upload; no remote rebuild.

## Guard / release gate

- Fresh affected guards: **78 executions passed / 0 failed**, includes imported duplicate cases.
- Canonical Makefile test-fast + test-browser: **25 test commands exit0**, final `npm run build`
  is command26. GNU Make unavailable; exact npm commands executed sequentially by Node.
- Initial pass20/25; stale assertions in release/assets/production/readiness rejected. Five focused
  reruns5/5 PASS after test repairs: visible timestamp changes HTML/shell/release identity;
  fixed credits HTML revalidates instead of using immutable asset naming; licensed attribution
  anchors are navigation rather than external shell dependencies; metadata liveness cache is
  separate from release cache; accepted popover/icon and auto-PNG replace old footer/consent.
- Activation14/0, readiness13/0, detection7/0, worker-production10/0 on current code. Safety, encoder
  failure, busy operations, PNG-before-navigation, one own reload, old-document offline assets and
  empty update covered. Separate phase8 browser9/0, two builds, failed install, frozen tab,
  last-old-client cleanup and foreign/user/demo sentinels unchanged.

## Production readback / browser

- **24 HTTPS paths**: every inventory path + SW/release/inventory metadata + root, HTTP200 and exact SHA.
- Fixed SW/release/inventory `no-store`; root/index `no-cache`; hashed assets one-year immutable;
  hashed manifest `application/manifest+json`. Credits HTML uses Netlify
  `public,max-age=0,must-revalidate`, also revalidated. Initial smoke expected literal no-cache
  for this auxiliary page; that assertion failed and is retained, then corrected to accept either
  equivalent revalidation policy. No production code change/redeploy was needed.
- **6 browser/readback cases PASS**: HTTP inventory; desktop1000 and viewport320 popovers;
  real pointer painting + PNG; offline reload/draw; full persistent-browser close then cold
  offline-before-navigation launch/draw. Active SW release and pinned shell match uploaded artifact.
- Geometry: app900px high in viewport900, icon44×44/left8/bottom8;
  popover320px desktop,304px at320 viewport. No Credits link; Save hidden without waiting update.
- Real downloaded PNG: 180×130, 16208 bytes, SHA `8ebf370d9d2038c29a31ec4de2693cfcf711cfb258102fc3c0c6782563f831bf`.
- Own HTTPS browsers closed; local review PID51008 stopped after closure, port3000 bind-back PASS.
  Source checkout has an unrelated pre-existing `PHASE7-REPORT.md` change left uncommitted.

## Evidence and limits

`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-prod-gate-0nOUKk/`: result.json,
production-artifact/, deployment.json, production-readback.json, initialCommands/rerun logs,
production-readback-initial.json, production-ui-{1000,320}.png, production-artwork.png,
production-offline-drawing.png, production-cold-offline-drawing.png, HAR/traces and profile.
Phase8: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase8-IuPmPV/result.json` PASS9.

Physical Android/iOS/Safari/standalone/native install/native GPU/OS reboot, offline demos/CDN CORS,
real browser quota/eviction and crash/aborted-navigation cleanup remain NOT TESTED.
No fabricated second production release: full V1/V2 upgrade matrix is isolated browser evidence.
Unknown/legacy clients and unobserved pending pins conservatively retain old caches;
without Web Locks cleanup is disabled. These limits are retained, not acceptance of phases9–10.
