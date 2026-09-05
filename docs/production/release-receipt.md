# Shell A release receipt

Published to the existing private Tailnet app on 2026-09-06 after the Owner selected A and requested production implementation plus commit/push.

## Source and delivery
- PR: https://github.com/labsiqbal/hermes-mobile/pull/2 — merged.
- Implementation merge: `42293e3a5e52fd367ffa934ab42512513a9d5dbb`.
- Main CI: https://github.com/labsiqbal/hermes-mobile/actions/runs/33987596468 — completed, success.
- Live app: https://nuc.tailcf7779.ts.net:8451/
- Published index SHA-256: `9783bf21c838108f53e837f1dcf307631f7100a09096ccfebe0048ea5b4c9fd0`.
- Guarded publisher added 8 immutable assets, replaced the entry last, and retained all 5 pre-existing files (the entry is the deliberate replacement). No cleanup, backup/restore, service restart, gateway/config/credential change, or Tailscale routing change.
- Independent HTTPS readback matched all 11 approved artifact files. A fresh browser with no saved credentials rendered the actual connection screen successfully; screenshot in `evidence/served-entry.png`.

## Quality evidence
- Real built-app fixture suite: 15 journeys PASS; explicit gateway/profile/session isolation, new-chat history/draft restoration, Workspace scroll, confirmation, keyboard focus and state/viewport checks. These are frontend/transport fixtures, not authenticated live integration tests.
- Browser harness: 26 self-test controls PASS; source/module regressions, management browser contracts and restored/live text reveal PASS.
- Lint (with warnings), TypeScript, production build and 31 static-publisher tests PASS. Dependency audit including development dependencies reported 0 vulnerabilities at execution.
- Independent clean dependency install/rebuild produced an identical 11-file artifact manifest.
- Standards and Spec findings were closed with regression tests; see `reviews.md`.
- Initial GitHub Chrome startup timeout was retained as a real failure. Narrow diagnostic instrumentation and subsequent cold-start checks passed remotely. Later cold-start PR/push checks and the merged-main run passed; no browser assertion was skipped, timeout inflated, dependency/browser installed, or application code changed for CI. See `evidence/ci-final-inputs.json` for the limited post-local-validation differences.
- Existing lint advisories and a GitHub Actions Node-runtime deprecation annotation remain warnings, not a clean-lint/security certification.

## What is intentionally not claimed
Shell A is now the live React interface, not a mockup. Full official Desktop parity remains incomplete. Workspace is bounded/read-only except explicit external preview opening; Manage provides scoped reads and narrow confirmed profile-description editing. Native Terminal/annotation and broader management writes are not implemented by pretending chat or a generic iframe is equivalent. Unsupported contracts fail visibly.

Authenticated live gateway operations, physical iOS/Android keyboard/sleep behavior, and a complete accessibility/security audit remain unverified. Saved credentials remain unencrypted browser storage, explicitly warned in the UI and README; use a private trusted device and private Tailnet. No live agent prompt, profile write or paid model call was used in validation.

## Evidence and rollback boundary
`evidence/artifact-manifest.json`, `evidence/publication.json`, and `evidence/served-verification.json` identify the delivered artifact and actual readback. Prior `validated-inputs.json` remains the original local verification snapshot; the separate final-CI record accounts for the later test-only changes.

Old source and immutable assets remain available. Rollback is a separately Owner-approved operation; this delivery did not perform a backup or automatic rollback. See `static-publication.md`.
