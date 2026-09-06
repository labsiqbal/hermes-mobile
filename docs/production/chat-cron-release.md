# HM-UX-04 release receipt

## Current state

**Corrective gate passed; PR/CI/merge/publication pending.** Parent explicitly authorized removing the surplus trailing blank line from `app/scripts/fixtures/chat-review.tsx`, preserving one terminal newline, and recording updated input provenance. Actual corrected-fixture browser regression passed all 6 checks with no diagnostics. Full baseline `git diff --check de9c5d1 --` passed. No functional code changed.

Historical interruption: the first executor incorrectly continued commit/push after the staged whitespace check exited 2. Commit [`680d7440489dbcae073d67b1883d3fa57c08bf66`](https://github.com/labsiqbal/hermes-mobile/commit/680d7440489dbcae073d67b1883d3fa57c08bf66) remains intact; this correction is a new commit, not an amend. [Blocker evidence](evidence/chat-cron-release-blocker.json) preserves the pre-resumption observation. No publisher invocation or static write has occurred at this corrective gate.

Owner authorized “gas live”, including source delivery and guarded static publication. [Corrective provenance](evidence/chat-cron-corrective-provenance.json) records old/new fixture hashes and the rerun. Original `/tmp/hm-ux04-release-86_66nsg/inputs.json` is immutable (SHA-256 `e52bef1f544b9e4dc2abda3fe8fbeeeece8ebf52462f526a1d22a01108ffd7bf`); all other 73 inputs remain unchanged. All 74 frozen-source inputs remain unchanged. Both candidate and frozen 13-file dist maps still exactly match the approved manifest. Original acceptance evidence was not regenerated.

## Approved immutable inputs

- Baseline: `de9c5d1b7272fb6ab3204370357d955dad9dbd06`. Candidate: `feat/chat-cron-refinement`.
- Frozen source/artifact: `/tmp/hm-ux04-release-86_66nsg/source/app/dist`; manifest `/tmp/hm-ux04-release-86_66nsg/artifact.json`.
- Manifest SHA-256: `8b5dbc9f13c56d9b5b88593a182748d2a4536826336dfcb4349dc8dacaf25960`.
- Approved entry SHA-256: `5cbef665628f4794df76437fd80c3145b95e729784d3348a68bf6e94649687c7`.
- Expected OLD live entry: `9783bf21c838108f53e837f1dcf307631f7100a09096ccfebe0048ea5b4c9fd0`.
- Expected full route digest: `5759f3513fa7dd18a01d1eefc840816737f9089387fbc30ea06b166c3aa6a1a5`.
- Release executor independently verified exact 74-file source/input map and 13-file artifact map against both candidate and frozen build. `.env*` files were excluded without reading.

## Quality and review

Parent performed clean lockfile installation/build (byte-identical artifact), dependency audit (0 vulnerabilities), unit/transport tests, lint (7 existing warnings), management browser, shell SSR (64 assertions) and publisher (31 temporary-tree tests). Release executor parsed and verified the frozen reports: features 17, review regressions 6, production journeys 15, harness self-tests 26, navigation journeys 2 and ChatView reveal scenarios 11. These counts use different units and are not summed. Parent approved final screenshots; all retained independent findings are closed in [review](chat-cron-review.md).

Durable evidence: [frozen gates/input map](evidence/chat-cron-frozen-gates.json), [approved artifact manifest](evidence/chat-cron-artifact-manifest.json), [builder gate evidence](evidence/chat-cron-builder-final.json). Original Shell A release receipts are preserved unchanged.

## Scope and limitations

Only existing `deploy/publish-static.py` may write the approved canonical static root, after guarded dry-run. Same manifest and old-entry/route guards are required for publication. Retain old chunks and publish entry last; no build in live root, service/restart/routes/config/credentials, live authentication, prompts, deletions, cron mutation, backup or automatic rollback. Stop on drift rather than substituting guards.

Post-publication verification must independently hash HTTPS files and boot actual served code in a fresh credential-free browser. That proves anonymous entry/asset delivery only, not authenticated UI compatibility. Physical iOS/Android, complete accessibility/security review and full Desktop parity remain unverified. Running-profile-only deletion, canonical protection and documented upstream concurrency limits remain in force.
