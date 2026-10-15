# Фаза 4 — production SW та перевірений offline shell

Стан: **прийнято власником через `handoff:next` 2026-10-15, фазу 4 закрито**.
Код/документи входять у closing commit поверх `66c65e1`; deploy не виконано.
Baseline `66c65e1`, Windows 11 / Node 24.19.0 / Chromium 153.0.8010.12,
ANGLE SwiftShader. Engine/palette/vendor/Netlify не змінено.

## Реалізація

- `app/pwa-worker.js` — build template; `pwa-release-build.js` серіалізує
  inventory у стабільний `dist/sw.js` **після** обчислення releaseId. Сам SW та
  metadata не входять до identity. Два real builds перевіряють однакові SW bytes.
- `app/pwa-register.js` входить лише до production bundle через `isProd` у Gulp.
  Source HTML його не завантажує; actual development build не містить SW чи
  registration. Secure context перевіряється, registration failure лише log,
  не readiness/UX. `scope: '/'`, `updateViaCache: 'none'`.
- Install читає **build-pinned** inventory, не довіряє змінному network JSON.
  Кожна спроба має власний `fluid-pwa-shell-v1-<releaseId>-<UUID>` staging cache.
  Для кожного entry: HTTP 200, не opaque/redirect/private, credentials omitted,
  MIME allowlist, HTML/JS/CSS/manifest/PNG/WOFF2 format checks, size і SHA-256.
  Hash гарантує exact built bytes; signature check не є повним PNG/font decoder.
- Complete marker `/__fluid_pwa_complete__` записується **останнім**. Serving
  відкриває тільки кеш власного release з marker і точною кількістю entries.
  Без complete cache повертається network error, не partial/mixed shell.
  Failed install видаляє тільки власний staging; complete старої identity й
  foreign caches не чіпає. Same-identity reinstall не перезаписує complete cache.
- Routing §3.3: GET same-origin navigation `/` та `/index.html` → pinned HTML;
  query URL не переписується. Inventory assets без query → cache-first;
  інші navigation/assets, SW/metadata, shader дерева, POST/auth/range та
  cross-origin → network-only, без HTML fallback. Немає SWR, reload,
  `skipWaiting()` чи `clients.claim()`.
- STATUS protocol — тільки diagnostic request-ID reply з releaseId/complete
  для actual worker probes; activation commands чи update/readiness UI немає.
  Cap/retention/rollback policy — фаза 8, **не реалізовано**.

## Виконувана перевірка

З кореня checkout, Git Bash, ручні servers зупинені:

```sh
node debug/pwa-phase4-eval.js
```

Це прямі Node entrypoints, без ненадійного npm wrapper. Runner сам робить
production build, guards, actual development build, два changed-source real
production builds у Temp, production persistent probe, retained browser probes,
fixture harness regression, cleanup і separate-process bind-back усіх owned ports.
Для вузького повтору:

```sh
NODE_ENV=production node node_modules/gulp/bin/gulp.js build
node --test debug/pwa-worker-test.js
node debug/pwa-worker-browser-test.js
```

`npm run test:pwa-worker`, `test:pwa-worker:browser`, `pwa:phase4:eval`
зареєстровані. Makefile додає guard/probe у fast/browser tiers.
Ці commands виконав автор; повторний parent audit не є передумовою delivery.
Власник прийняв фазу 4 командою `handoff:next` 2026-10-15.

## Історичний eval реалізації 2026-10-14

Evidence root: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase4-final-5sYqN3/`.
`result.json` має exact executable/argv/env/cwd, stdout/stderr, exit codes,
окремі suite counts та absolute artifact paths. Production probe —
`production-probe/result.json`; повні traces/HAR/PNG, browser/server logs,
`v1`/`v2`/`v3` dist snapshots, isolated source і persistent profile збережені.

- Build PASS, exit 0. Guard: worker **10/0**, release **4/0**, assets **7/0**,
  harness **5/0**, shader **25/0**, demo **8/0**, palette adapter **6/0**.
  Fluid control API: PASS (script не перелічує окремі assertions).
  Це різні suites, не один сумарний acceptance count.
- Production browser **10 cases PASS / 0 failed**. П'ять persistent browser
  processes закрито/disconnected; три real offline cold navigations після close,
  offline встановлено до першого navigation. V1 cache: 19 inventory entries +
  last-written marker; exact cache hashes/HTTP MIME/headers перевірено.
- Offline WebGL1/2: pointer draw, resize 180×130 → 196×142 та viewport resize,
  actual UI Bake, PNG download 196×142, local PNG import, retained 1.9 MB story
  import. Bake max rendered delta=0, wet magnitude=0, Undo/Redo=false,
  GL/page errors=0. Локальний 12-tile subset тієї самої retained story
  повністю відтворився: **14/14 operations, pending=0**, обидва WebGL backends.
  Повний playback великої story **НЕ підтверджено**.
- Network cut: server реально розриває TCP socket на required JS після
  попередніх install fetches (17 requests із retry, 2 cut hits); worker redundant,
  waiting=false. Required JS 404: 16 fetches, 1 404 hit, redundant/waiting=false.
  Після кожного CacheStorage byte-identical V1, partial cache відсутній;
  old app reload offline і наступний browser restart працюють.
- Valid V2 install лишається waiting, active V1 незмінний, URL/reload не
  змінено; після закриття всіх clients browser природно активує V2, cold
  offline shell показує `v2 Fluid Paint`. Це lifecycle proof, не update UX.
- Query `/` і `/index.html` збережені; unknown JS/shader/SW/metadata offline
  відхиляються без HTML. Same-origin controlled iframe з exact editorOrigin
  проходить реальний vendored handshake; actual iframe іншого origin/window
  не досягає ready (bounded 600ms timeout), стан застосунку не змінився.
- Retained probes: phase1 **2 viewport PASS**, phase2 **2 WebGL cases PASS**,
  disposable phase3 selftest **8 cases PASS**; fixture scope/protocol/timeouts
  збережені. Old no-production-SW assertions замінено фазовими інваріантами:
  production identity + isolated fixture + production SW byte preservation,
  production registration vs actual dev/source exclusion, не видалено checks.
- Review servers зупинено, bind-back PASS; окремий Node process підтвердив
  звільнення owned ports. Чужі процеси не зупиняли, review stand не залишено.
  `git diff --check`: PASS. Screenshots переглянуто автором: синій мазок/PNG
  непорожні, playback показує completed/14/14, embedded app реально rendered.

## Closing check 2026-10-15

Production build PASS; свіжі окремі guards: worker **10/0**, release **4/0**,
assets **7/0**, harness **5/0**. Збережені root commands і browser result.json
повторно прочитано: PASS/exitCode=0, production 10 cases, assets 2 viewport,
release 2 WebGL, fixture 8 cases. Browser probes не перезапускались; ці числа
історичні. Port 3000 незалежно bind-back PASS. NOT TESTED нижче збережено.
Наступна фаза 5 — readiness/install UX після окремого дозволу почати.

## Межі та чесний NOT TESTED

- Real browser quota exhaustion, wrong MIME/HTML/hash injection — **NOT TESTED
  у браузері**; усі rejection branches включно з quota/network/status/MIME/
  HTML/hash/format/private/opaque/redirect виконані exact-worker Node guards.
  Network cut і required 404 додатково пройдені actual production worker.
- Повна 1.9 MB story до кінця, physical GPU/Android/iOS/standalone, OS reboot,
  storage eviction/persist refusal, suspended/multi-tab activation policy,
  retention cap/rollback, live CDN headers/CORS/downloaded demos та deploy —
  **NOT TESTED** або фази 5–10. Full `make verify` не запускався.
- Painting resize — existing debug preview/commit API, не edge-pointer gesture.
  Draw/Bake/export/import/playback — справжні controls/file inputs.
- Browser storage не гарантується назавжди; offline restart не відновлює
  попередній wet drawing. Readiness/warning/install/update UX ще фаза 5+;
  ця фаза не показує користувачу фальшивого «offline ready».
- Early scratch failures збережені у Temp, не acceptance: full large-story
  playback перевищив 90s; old phase3 no-SW guard мав змінитися; waiting probe
  спочатку мав timing race, замінено bounded polling до installed перед message.
  Final evidence вище — окремий успішний прогін, невдачі не приховано як PASS.

[QA-4A–4P](./QA.md) · [HANDOFF](./HANDOFF.md) · [Спека §3.3/4/8A](./PWA-OFFLINE-UPDATE-SPEC.md)
