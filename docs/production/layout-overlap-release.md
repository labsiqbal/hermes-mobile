# HM-UX-05 release receipt

## Reviewed and authorized candidate

Owner authorized **“Ya, lanjut sampai live”** for HM-UX-05. Parent independently reviewed all four layout corrections visually and reran the final 62-check browser suite successfully. The release executor verified the frozen source, builder receipt and candidate artifact identities, performed a clean isolated lockfile install/build and reran 62/62 layout checks. All 13 rebuilt deployable files match the approved candidate exactly. No functional source edits were made during release execution; only review/delivery documentation was finalized.

Source PR/CI, merge, guarded publication and anonymous live boot are pending at this source-commit snapshot. The final receipt will record their actual results, separately from fixture evidence. The preceding executor's canonical-cleanliness blocker was resolved by the parent: `.hermes/` and `design/reviews/` are known pre-existing untracked material, preserved untouched. Canonical tracked files were clean and incoming tracked paths did not collide. No new Owner decision was required.

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

Only the existing `deploy/publish-static.py` may publish, after its guarded dry-run with identical arguments plus `--publish`, adding immutable assets and switching entry last. No canonical builds, `serve.sh`, service/restart, route/config/credential changes, backup, rollback, authentication, live prompts, session or cron mutations are authorized. Old receipts and old assets must remain unchanged. Canonical source updates are ff-only with tracked cleanliness and untracked collision checks.

Anonymous byte readback and fresh credential-free real-browser boot are required after publication. They do not prove authenticated backend compatibility or physical iOS/Android, nonzero device safe-area, or assistive-technology behavior. Final external readback is parent-owned.
