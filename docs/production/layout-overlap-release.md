# HM-UX-05 release receipt

## Published and verified

Owner authorized **“Ya, lanjut sampai live”** for HM-UX-05. Parent independently reviewed all four layout corrections visually and reran the final 62-check browser suite successfully. The release executor verified the frozen source, builder receipt and candidate artifact identities, performed a clean isolated lockfile install/build and reran 62/62 layout checks. All 13 rebuilt deployable files match the approved candidate exactly. No functional source edits were made during release execution; only review/delivery documentation was finalized.

**Published on 2026-09-06 with successful anonymous byte readback and real-browser boot.** [Source PR #5](https://github.com/labsiqbal/hermes-mobile/pull/5) merged exact reviewed head `d2ebf08e33f3d50e90950afa15d47610a5740417` as `531f1c0bc303a37c47112437c536a34bfcfc0554`. [PR CI](https://github.com/labsiqbal/hermes-mobile/actions/runs/34008462342) and [merged-main CI](https://github.com/labsiqbal/hermes-mobile/actions/runs/34008560156) both completed successfully before publication. Canonical main was fast-forwarded only, with no canonical build. [Source delivery JSON](evidence/layout-overlap-source-delivery.json) pins these exact external readbacks.

The preceding executor's canonical-cleanliness blocker was resolved by the parent: `.hermes/` and `design/reviews/` are known pre-existing untracked material, preserved untouched. Canonical tracked files were clean and incoming tracked paths did not collide. The ff-only verifier compared all six untracked file hashes before/after. No new Owner decision was required; no other release blocker occurred.

## Publication and anonymous verification

- Existing `deploy/publish-static.py` passed [guarded dry-run](evidence/layout-overlap-dry-run.json), which the delegated executor [accepted under Owner authority](evidence/layout-overlap-dry-run-acceptance.json). Identical arguments plus only `--publish` returned **published / complete**, no error. No drift guard was replaced.
- [Publication receipt](evidence/layout-overlap-publication.json): eight immutable assets added, entry switched last, all 21 pre-existing non-entry files retained unchanged. Approved artifact: 13 files; final live tree: 30 files. Historical receipts and chunks remain intact.
- [Separate HTTPS verifier](evidence/layout-overlap-served-verification.json): all 30 files matched disk and expected hashes through 60 anonymous GETs, plain and cache-busted. No proxies, cookies, authorization or redirect following; full serve-route guard unchanged.
- [Fresh real Chrome boot](evidence/layout-overlap-browser-verification.json) loaded the actual served `/#home`, not a fixture, at 390×844: mounted connection registry, zero devices, empty password/storage/cookies, visible credential warning, no diagnostics, no API calls or WebSockets. Fetched entry/JS/CSS/support bytes matched the manifest. Browser exited and disposable profile was removed.
- The release executor visually checked the [anonymous entry screenshot](evidence/layout-overlap-served-entry.png): complete connection registry and empty form, no loading/error/fixture overlay. This does not substitute for the parent's independent visual review of the four authenticated-screen fixes.
- [Release JSON](evidence/layout-overlap-release.json) indexes publication, verification and source receipts with checksums. Original temporary receipts remain under `/tmp/hm-ux05-release-3v327ujn/`; durable copies are byte-identical.

## Immutable release inputs

- Baseline: `7606cf293be4074f82c8ab8ac4270c0e733028f5`; candidate branch `fix/mobile-layout-overlap`.
- Original nine-file staged diff SHA-256: `b3fed0368e2059c715a27b06dc054601934c810e4019a9e7e4aacb462aeff061`. The original source receipt remains unchanged; later documentation changes are recorded separately.
- Frozen source receipt: `/tmp/hm-layout-overlap-frozen-source.json`; SHA-256 `9de2ea2dbf6ecb20b10b30ce0bd0b2319ec7be3e154692e50172e714995043cd`.
- Rebuilt artifact: `/tmp/hm-ux05-release-3v327ujn/source/app/dist` (outside live root).
- Artifact manifest: `/tmp/hm-ux05-release-3v327ujn/artifact.json`; SHA-256 `243dff3159a7a1259c97c2f73bc889e832943147592480c35b4b3a0832c62931`. [Durable manifest](evidence/layout-overlap-artifact-manifest.json).
- Approved entry SHA-256: `1fa8bc2fd6d267f6dd58be5cf0c813ff7f739b1ad2b5391f14dfd179b19dfb91`.
- Expected OLD live entry SHA-256: `5cbef665628f4794df76437fd80c3145b95e729784d3348a68bf6e94649687c7`.
- Full serve-route guard: `5759f3513fa7dd18a01d1eefc840816737f9089387fbc30ea06b166c3aa6a1a5`.
- Fixed origin: `https://nuc.tailcf7779.ts.net:8451/`; fixed canonical static root: `/home/iqbal/workspace/personal/hermes-mobile/app/dist`.

Clean rebuild exported indexed app inputs only; every `.env*` path was excluded without reading, including `app/.env.example`. Install used `NODE_ENV=development npm ci --include=dev --ignore-scripts --no-audit --no-fund`, followed by `npm run build`. Logs and input map are under the immutable release directory. [Freeze/rebuild evidence](evidence/layout-overlap-freeze.json) records source/receipt hashes and preserves the parent attribution.

## Quality and limits

[Correction report](layout-overlap-fix.md) documents root causes and final identical-runner RED 48 failed / 14 passed → GREEN 62 passed. Builder gates passed: unit, lint (exactly seven unchanged baseline warnings), build, 17 feature checks, six review checks, 15 production journeys, 26 harness self-tests, two navigation journeys, 11 reveal checks and management widths 360/390/430. Parent independently passed 62 layout checks; the release executor additionally passed 62 against its clean rebuilt artifact. These use different units and are not summed.

Only the existing `deploy/publish-static.py` wrote the fixed static serving root, after its guarded dry-run with identical arguments plus `--publish`, adding immutable assets and switching entry last. No canonical builds, `serve.sh`, service/restart, route/config/credential changes, backup, rollback, authentication, live prompts, session or cron mutations occurred. Old receipts and old assets remain unchanged. Canonical source updates are ff-only with tracked cleanliness and untracked collision checks. CI also emitted its existing action-runtime Node deprecation annotation; this did not fail the gate and no workflow dependency was changed during release.

Anonymous byte readback and fresh credential-free real-browser boot passed after publication. They do not prove authenticated backend compatibility or physical iOS/Android, nonzero device safe-area, or assistive-technology behavior. Final external readback remains parent-owned; this executor does not claim to have performed the parent's final verification.
