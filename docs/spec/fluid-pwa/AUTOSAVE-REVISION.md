# Minimal PWA / automatic PNG revision

## Поточний локальний review — minimal status + automatic PNG

**Supersedes the icon-only UI/consent contract below; prior measurements remain historical.**
**Прийнято власником через `handoff:next` 2026-10-15; фазу 7A закрито.** Closing commit авторизований цією командою; нового external deploy немає. Незакриті technical/physical/legacy обмеження нижче збережені.

- Live: http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41 . Same freshly checked node.exe **PID31212**, parent70768; no listener restart.
- Release `2195ab1b3a1e1a35d8201df0daa1c1b1d52dd77bb50a6b525f8845f446255e69`; build metadata **2026-10-15T18:49:32.443Z**, visible **2026-10-15 18:49** (UTC minute, not runtime clock/hash). Full hashes remain internal. Snapshot build has `gitSha:null` (no Git metadata in copied source); source SHA comparison is recorded separately, not invented revision metadata.
- Visible information: Active version and Last check / No update found. Verbose preparation, backup, shell hash, verified-update and install instructions removed. Real licensed SVGs retained; minimal Credits link opens distributed/offline-cached `pwa-credits.html` with Dazzle UI / SVG Repo / CC BY4.0 attribution.
- Save PNG invokes actual painter export. Explicit Update on the **new code** checks real pigment readback / baked-or-imported background (dirty remains unknown), automatically downloads nonempty artwork, then rechecks busy/candidate identity before ALLOW. Empty canvas does not download. Encoder/readback/candidate/storage failures fail closed. No repeated file-check/discard dialog. PNG remains flattened, not wet-paint/Undo persistence; browser download initiation cannot prove the user's final disk destination.
- Evidence `$A = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-autosave-x4ZnZf`: `result.json` **PASS_WITH_LEGACY_LIMITATION**. Two isolated production builds; affected **54 tests passed / 0 failed** (`unit.log`, repeated current-checkout `final-unit.log`). Actual browser proves pointer PNG before one reload, encoder failure preserving old active/artwork/waiting with no download/reload, empty update with zero downloads, menu PNG, desktop/320 minimal UI, exact HTTP/cache inventory and retained old immutable URLs. Not a full make verify or physical-device rerun.
- Auto PNG `auto-update-pointer-artwork.png`: **180x130, 23159 bytes**, SHA `b942d80cb3ae21fe7a4bfdb4a62f3e4e5ff34a2ffe7b2aa96cdea195cee59e5f`, decoded **8230 colored pixels**. Menu PNG: **180x130, 20856 bytes**, decoded **8750 colored pixels**. Not blank/synthetic exports.
- **Legacy limitation, not automatic-save PASS:** real persistent/restarted `ca3c9da7…` localhost client existed before publication, retained pointer artwork/document while `registration.update()` fetched exact new complete waiting release. Its already-loaded immutable JS necessarily kept its old Export PNG + separate confirmation path. That real PNG was exported and decoded before one explicit consenting reload to the new version. No old bundle rewrite, script injection, forced activation or user data clearing. New one-click auto-save applies after this first upgrade; retroactive auto-save in the old document is not claimed.
- Screenshots: `$A/new-ui-desktop.png`, `new-ui-320.png`, `legacy-ca3-waiting.png`; valid PNGs, HAR/traces, `cache-snapshot.json`, frozen `source/`, `v2/`, `old-dist-backup/` retained. Owned test browsers closed; own test ports bind-back verified; retained3000 remains running.
- Intermediate failures retained: `fluid-pwa-autosave-gFfxmx` pointer setup while expanded dock; `4YxzbB` old inventory guard assumed every non-index entry immutable (fixed for separate fixed credits HTML). Main `$A` hit one No-update wait timeout after successful save/failure/empty probes; fresh persistent-profile check and bounded `resume.cjs` completed UI/publish/legacy/cache verification. Original failure is retained in `previousRunnerError`; not relabelled a clean uninterrupted run.
- Full details and exact source list: [AUTOSAVE-REVISION.md](./AUTOSAVE-REVISION.md). Physical/native/Safari/CORS debt unchanged. 7A прийнята через `handoff:next`. Старий retention/cap/локальний rollback scope скасовано власником; scope8 (cleanup + дві вкладки) реалізовано за окремим дозволом, очікує human review; поточні докази й обмеження — PHASE8-REPORT.md. Чинний контракт — HANDOFF.md та PWA-OFFLINE-UPDATE-SPEC.md §4.1; історичні вимірювання не змінено.

## Final retained-origin readback

`final-verification.json` PASS: 8 current production/build source files SHA-identical to the tested snapshot; all 20 current inventory URLs HTTP200/SHA-exact; 18 previous immutable URLs retained/SHA-exact. `retained-final.json` PASS: restarted owned localhost profile controlled by the exact new complete release, visible `Active version: 2026-10-15 18:49` and `Last check … No update found`; separate credits HTML opens with actual CC BY4.0 link. Screenshot `retained3000-final-ui.png`. Same PID31212/parent70768 read back after publication. Index remains empty; `git diff --check` PASS.

## Exact files changed in this revision

Production: `app/pwa-register.js`, `app/pwa-worker.js` (STATUS adds release buildTime only), `paint.js` (real nonempty detection, PNG validation), `debug/pwa-release-build.js` (one metadata timestamp bound into HTML/inventory/STATUS), `gulpfile.js` (credits static copy), new `pwa-credits.html`.
Tests: `debug/pwa-activation-test.js`, `debug/pwa-detection-test.js`, `debug/pwa-readiness-test.js`, `debug/pwa-ux-test.js`, new `debug/pwa-autosave-test.js`, new `debug/pwa-autosave-browser-test.js`.
Docs: this file, `HANDOFF.md`, `QA.md`, `PHASE7A-REPORT.md`.
Pre-existing shared changes, original SVGs/icon PNGs, palette/physics/vendor were not reset or staged.

## Repeatable bounded unit verification

```sh
node --test debug/pwa-activation-test.js debug/pwa-detection-test.js debug/pwa-readiness-test.js debug/pwa-worker-test.js debug/pwa-ux-test.js
```

The browser runner is a one-time **publish-capable** ca3-to-new test, not a read-only default command: it asserts ca3 currently served before changing anything. It now refuses rerun against the newer retained release. Do not rerun it expecting read-only QA. Frozen original runner and `resume.cjs` are retained in evidence; the latter reused exact already-tested B, no new build. All snapshot/build work was outside retained dist; final directory swap retained old immutable URLs and read them back.

## Current QA actions

- Open dock: only Active version minute and Last check status information; Save PNG and icon controls remain.
- Draw, Save PNG: real flattened image downloads. Credits opens a separate attribution page.
- On a new-code waiting update, click Update once: automatic real nonempty PNG, then one verified reload. No manual backup confirmation. An empty painting updates without downloading.
- Held stroke/import/export/Bake/playing/paused is blocked. Export/readback failure leaves waiting release and artwork unchanged; retry is explicit. Queued duplicate, candidate changed during export, dirty work arriving during export and unknown/missing safety are unit-tested.
- Existing ca3 documents necessarily retain old confirmation controls for their first migration; that exception was exercised on retained3000 rather than hidden by injecting new code.

## Limits

No external deploy, staging, commit, full make verify, physical device, Safari/native install or OS reboot. PNG preserves pixels, not Undo/wet simulation. Browser download API completion is not proof of final filesystem persistence. Existing historical `pwa-phase7a-eval.js` / older consent browser tests target the superseded UI and were not presented as current full-suite PASS.
