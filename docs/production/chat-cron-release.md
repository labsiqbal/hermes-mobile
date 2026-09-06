# HM-UX-04 release receipt

## Current state

**Published and independently verified on 2026-09-06.** Source [PR #3](https://github.com/labsiqbal/hermes-mobile/pull/3) merged exact corrected head `17faabc56f70d8ff4af3707ab2f8b084d1ac38c3` as `bb9d003f24d95840bf05e9db5feed7f0cf5e8eee`. [PR CI](https://github.com/labsiqbal/hermes-mobile/actions/runs/34005835731) and [merged-main CI](https://github.com/labsiqbal/hermes-mobile/actions/runs/34005927700) both completed successfully before publication. Canonical main was fast-forwarded only; no build ran in canonical dist.

Historical interruption: the first executor incorrectly continued commit/push after the staged whitespace check exited 2. Commit [`680d7440489dbcae073d67b1883d3fa57c08bf66`](https://github.com/labsiqbal/hermes-mobile/commit/680d7440489dbcae073d67b1883d3fa57c08bf66) remains intact. Parent authorized a new corrective commit removing exactly one surplus trailing LF from `app/scripts/fixtures/chat-review.tsx`, preserving one terminal newline. [Blocker evidence](evidence/chat-cron-release-blocker.json) preserves the pre-resumption observation; [corrective provenance](evidence/chat-cron-corrective-provenance.json) records the actual 6-check browser rerun. Full baseline and staged whitespace checks passed before commit. No functional code changed during release execution.

Owner authorized “gas live”, including source delivery and guarded static publication. Original `/tmp/hm-ux04-release-86_66nsg/inputs.json` is immutable (SHA-256 `e52bef1f544b9e4dc2abda3fe8fbeeeece8ebf52462f526a1d22a01108ffd7bf`); all other 73 inputs remain unchanged. All 74 frozen-source inputs remain unchanged. Candidate and frozen 13-file dist maps exactly matched the approved manifest before publication. Original acceptance evidence was not regenerated.

## Publication and live readback

- Live origin: **https://nuc.tailcf7779.ts.net:8451/**. Published entry SHA-256: `5cbef665628f4794df76437fd80c3145b95e729784d3348a68bf6e94649687c7`.
- Existing publisher passed the guarded [dry-run](evidence/chat-cron-dry-run.json); delegated release executor [accepted it under Owner authority](evidence/chat-cron-dry-run-acceptance.json). Identical arguments plus only `--publish` returned `status=published`, `stage=complete`, no error.
- Actual stdout receipt: `/tmp/hm-ux04-release-86_66nsg/publication.json`; durable byte-identical copy: [chat-cron-publication.json](evidence/chat-cron-publication.json). Eight immutable assets added, entry replaced last, all 13 pre-existing non-entry files retained. Approved artifact: 13 files; final live tree: 22 files (shared paths are counted once).
- Publisher verified every approved and retained file, plain and cache-busted. A separate [HTTPS verifier](evidence/chat-cron-served-verification.json) independently matched all 22 live files using 44 anonymous GETs, including all 13 approved artifact files. No redirects, proxies, cookies or authorization headers were used.
- A [fresh real Chrome boot](evidence/chat-cron-browser-verification.json) rendered the actual connection registry at 390×844, empty device list/form/storage/cookies and the credential warning, with no diagnostics. Browser response hashes matched the frozen entry, JS, CSS and fetched support files; no fixtures, API calls, WebSockets, login or live prompts. [Screenshot](evidence/chat-cron-served-entry.png) visually reviewed.
- The first temporary live-browser verifier incorrectly required a fragment-free URL. [Failure](evidence/chat-cron-browser-initial-failure.json) and [diagnostic rerun](evidence/chat-cron-browser-diagnostic.json) are retained: the mounted app correctly initialized `#home` via `ShellNavigation`. Only the temporary verifier's exact URL expectation changed to `/#home`; the timeout and all byte/DOM/credential gates remained intact. No application change or republication was needed. [Source delivery evidence](evidence/chat-cron-source-delivery.json) pins the verifier hashes and source/CI readbacks.

## Approved immutable inputs

- Baseline: `de9c5d1b7272fb6ab3204370357d955dad9dbd06`. Candidate: `feat/chat-cron-refinement`.
- Frozen source/artifact: `/tmp/hm-ux04-release-86_66nsg/source/app/dist`; manifest `/tmp/hm-ux04-release-86_66nsg/artifact.json`.
- Manifest SHA-256: `8b5dbc9f13c56d9b5b88593a182748d2a4536826336dfcb4349dc8dacaf25960`.
- Approved entry SHA-256: `5cbef665628f4794df76437fd80c3145b95e729784d3348a68bf6e94649687c7`.
- Expected OLD live entry: `9783bf21c838108f53e837f1dcf307631f7100a09096ccfebe0048ea5b4c9fd0`.
- Expected full route digest: `5759f3513fa7dd18a01d1eefc840816737f9089387fbc30ea06b166c3aa6a1a5`.
- Before the authorized correction, the release executor independently verified the exact 74-file source/input map and 13-file artifact map against candidate and frozen build. The separate corrective provenance accounts for the sole fixture difference. `.env*` files were excluded without reading.

## Quality and review

Parent performed clean lockfile installation/build (byte-identical artifact), dependency audit (0 vulnerabilities), unit/transport tests, lint (7 existing warnings), management browser, shell SSR (64 assertions) and publisher (31 temporary-tree tests). Release executor parsed and verified the frozen reports: features 17, review regressions 6, production journeys 15, harness self-tests 26, navigation journeys 2 and ChatView reveal scenarios 11. These counts use different units and are not summed. Parent approved final screenshots; all retained independent findings are closed in [review](chat-cron-review.md).

Durable evidence: [frozen gates/input map](evidence/chat-cron-frozen-gates.json), [approved artifact manifest](evidence/chat-cron-artifact-manifest.json), [builder gate evidence](evidence/chat-cron-builder-final.json). Original Shell A release receipts are preserved unchanged.

## Scope and limitations

Only existing `deploy/publish-static.py` wrote the approved canonical static root, after guarded dry-run with the same manifest and old-entry/route guards. Old chunks were retained and entry published last. No build in live root, service/restart/routes/config/credential changes, live authentication, prompts, session deletion, cron mutation, backup or automatic rollback occurred. Future rollback or asset pruning requires separate approval; do not reuse the historical old-entry guard for another release.

Post-publication HTTPS hashing and fresh credential-free browser boot prove anonymous entry/asset delivery only, not authenticated UI compatibility. Physical iOS/Android, complete accessibility/security review and full Desktop parity remain unverified. Running-profile-only deletion, canonical protection and documented upstream concurrency limits remain in force. Final external readback remains parent-owned.
