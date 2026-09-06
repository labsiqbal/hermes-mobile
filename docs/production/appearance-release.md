# HM-UX-06 + HM-UX-07 live release

**Published and anonymously verified on 2026-09-06** at <https://nuc.tailcf7779.ts.net:8451/>. Owner authorized “live in bro gw mau test”. This release combines native Chats reads/two-filter browsing with device-local Appearance scales and the unified composer. It does not change gateway authentication, services, routes or runtime configuration.

## Source delivery and reproducibility

[Source PR #7](https://github.com/labsiqbal/hermes-mobile/pull/7) delivered exact frozen source `67359166ede295d3ffb8e48e6513ef2cda3bebd7`, merged as `c7d5483bbe9bf2213c6bd849ba2640c6064f6367`. [PR CI 34015328777](https://github.com/labsiqbal/hermes-mobile/actions/runs/34015328777) and [merged-main CI 34015537112](https://github.com/labsiqbal/hermes-mobile/actions/runs/34015537112) both passed before publication. [Source delivery evidence](evidence/appearance-release-source-delivery.json) records exact remote readbacks.

- Baseline: `f2f9ef9d052885ac75173a6db1e38fb99a937e9c`; 40 staged files; frozen tree `0e999f5b57acffcfef66f628a6d40998afb54b0f`.
- Original combined freeze SHA-256: `586f0872ecb94c2eb8f93e6c7b3095f05cb89b3c52396eb3ad51f7c462c4f3c3`. [Byte-identical durable copy](evidence/appearance-release-builder-freeze.json). Original combined and historical HMUX06 freezes remain unchanged.
- Exact index/worktree files, 74 declared build inputs, all eight frozen suite reports and 186 appearance screenshots matched their frozen hashes. Parent independently reran 466 appearance checks and visually reviewed compact/large-short composer; HMUX06 native 17 was already parent-reviewed. The combined builder native suite also passed 17 checks. These are fixture results, not authenticated live acceptance.
- Clean isolated `NODE_ENV=development npm ci --include=dev --ignore-scripts --no-audit --no-fund` and `npm run build` reproduced **12/12** reviewed artifact files. Indexed app files were exported to `/tmp/hm-ux0607-release-p72qsv83/source`; all `.env*` paths were excluded unread. No build ran in canonical `app/dist`.
- Cached and full-baseline whitespace gates passed immediately before the explicit source commit. No runtime source or test changes were made during release execution; remote SHA was verified before PR creation.
- Canonical main advanced only by fast-forward after a clean tracked-tree check, exact incoming ancestor/full tracked-tree collision check and before/after comparison of the six known untracked files. `.hermes/` and `design/reviews/` were preserved; nothing was deleted, stashed or staged. [Preservation proof](evidence/appearance-release-preserved-untracked.json).

## Publication and live evidence

The existing `deploy/publish-static.py` alone published the isolated artifact. [Guarded dry-run](evidence/appearance-release-dry-run.json) passed and was [accepted under delegated Owner authority](evidence/appearance-release-dry-run-acceptance.json); identical arguments plus only `--publish` returned [published / complete](evidence/appearance-release-publication.json).

| Identity | Exact value |
|---|---|
| Approved artifact directory | `/tmp/hm-ux0607-release-p72qsv83/source/app/dist` |
| Frozen publisher manifest | `/tmp/hm-ux0607-release-p72qsv83/artifact.json` |
| Manifest SHA-256 | `c20dd0d40d7e24c1c47ef84664f45957680b147951958ede8fd76f4bc4cb0b83` |
| Prior live entry guard | `1fa8bc2fd6d267f6dd58be5cf0c813ff7f739b1ad2b5391f14dfd179b19dfb91` |
| Published entry SHA-256 | `4cdfb4b705c173e12ab07a703af937140a113c3bd7b5826685facc2e2417434d` |
| Full Serve route digest | `5759f3513fa7dd18a01d1eefc840816737f9089387fbc30ea06b166c3aa6a1a5` |
| Serving directory | `/home/iqbal/workspace/personal/hermes-mobile/app/dist` |

The [durable candidate manifest](evidence/appearance-release-artifact-manifest.json) contains 12 files. Nine immutable assets were added, entry switched last, and all 29 prior non-entry files retained. The live tree consequently contains **39 files**, not 12. No drift guard was substituted.

A [separate HTTPS verifier](evidence/appearance-release-served-verification.json) checked all 39 live files through **78 anonymous GETs**, plain and cache-busted, against exact disk/manifest hashes. It used no proxies, cookies, authorization or redirect following, and verified the unchanged full route digest.

[Fresh real Chrome](evidence/appearance-release-browser-verification.json) loaded the actual served `/#home` at 390×844, with no fixtures, API requests, WebSockets, saved credentials or cookies. Native local/session storage and password were empty; all loaded entry/JS/CSS/support response hashes matched the artifact; diagnostics were empty. Chrome exited and its disposable profile was removed. The [entry screenshot](evidence/appearance-release-served-entry.png) visibly shows the complete anonymous connection registry, empty device form, zero devices and credential warning, without clipped controls or a loading/error overlay.

## Durable receipt delivery

[Release JSON](evidence/appearance-release.json) indexes exact source/CI/publication/verification identities and checksummed supporting receipts. Original execution evidence remains in `/tmp/hm-ux0607-release-p72qsv83/`. The receipt-only branch is `docs/appearance-release-receipt`.

The receipt commit cannot embed its own Git SHA or future CI results. After its PR merges, exact receipt head/merge, PR URL, PR/main CI IDs, final canonical state and post-receipt preservation proof are finalized in `/tmp/hm-ux0607-release-p72qsv83/final-state.json` and a byte-verified durable comment on the receipt PR. The receipt PR is discoverable by the branch above. This separates application publication from later evidence delivery without another publication.

## Limits

Anonymous byte readback and real-browser boot passed; authenticated gateway compatibility, physical-phone behavior, real keyboards, nonzero safe areas and accessibility zoom remain Owner tests. Seven baseline lint warnings and the existing CI action-runtime deprecation annotation remain. The existing `manifest.webmanifest` response MIME is `text/plain`; routing/server behavior was intentionally left unchanged. Old release receipts are historical, not rewritten. No `serve.sh`, service restart, route/port mutation, auth/login, prompt/session mutation, secret/local Hermes configuration read, backup, rollback or asset pruning occurred. Parent final independent external readback is separate and is not claimed by this executor.
