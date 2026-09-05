# Shell A independent review record

Baseline: `9b25ec831e144ff5182978002d4bbb2ddb6521f1`. Review target is the real React candidate, not the simulated prototype. At this initial review, source had not yet been published as the production replacement. The later verified release is recorded in `release-receipt.md`.

## Standards

Independent reviewer retained three behavioral defects, no heuristic-only refactors:

1. **P1:** a new conversation retains `unpersisted:true`; reopening omits RPC history and skips REST, hiding a settled turn.
2. **P2:** the client draft UUID and eventual server session ID select separate draft caches on normal list re-entry.
3. **P2:** Manage profile/page selection disappears through Devices/Settings.

Evidence: `/tmp/hm-standards-review/review.md`, `evidence.json`, `reproduce.mjs`. These use actual React and explicitly fictional transport. The reviewer rebuilt after the separate settled-text animation fix and reproduced the persistence/identity issues again.

## Spec

Independent reviewer reproduced the same new-conversation history and draft-identity defects against PA-02/04/05. It also flagged stale browser fixtures requiring management reads to be unavailable; the adapter now uses the sourced active-runtime-profile handshake rather than unreachable schema discovery. That fixture correction is integrated; final regression proof remains gated.

Evidence: `/tmp/shell-spec-review.mjs` and `/tmp/shell-spec-review/evidence.json`.

No material scope creep was found. The review explicitly distinguishes a usable A-shell migration from full Desktop parity. Management is substantially inspection-only; Kanban task mutations, general terminal/annotation and full Accent parity remain incomplete or unavailable.

## Built-app browser diagnostics

`/tmp/hm-production-qa-final-contract-v3/report.json` verifies working login, roots, project resume, Groups, Activity and sourced Manage fixtures, but remains RED:

- Workspace preserves draft but restores the wrong reading position.
- Approval click samples a moving entrance animation before its button enters the viewport; verify deterministic target readiness, not longer blind waits or weaker assertions.
- An earlier isolated run found command-palette focus containment trouble; recheck independently after dependent failures are cleared.

## Closure gate

A bounded builder correction owns the actual source and regression cases. All retained findings need current-code proof of closure, a fresh full browser report with every mandatory journey present, independent parent visual review, and final lint/build/whitespace/transport checks. Reports from different artifact hashes must not be combined into a green receipt.

Production source commit/push, remote CI and static publication were gated on closure. No real credential access, agent prompts, gateway mutations, service restart or routing change was used for these reviews.

## Final closure — parent independently verified

All retained Shell A release defects are closed on the source hashes in `evidence/validated-inputs.json`:

- Fresh-only persistence hints yield to completion/resume evidence; the fixture now honors `omit_messages`. Created-session history survives Back/Forward.
- Creation IDs alias to scoped durable/resolved view identities; normal list reopening restores the same unsent draft.
- Manage preserves page/profile navigation only, gateway-scoped; content is refetched, and write drafts/review tokens are not restored.
- The initial measurement pin yields when the reader scrolls away. Workspace restoration preserves the reading position rather than snapping to bottom.
- Tap readiness waits for a stable, visible, unobstructed target; pointer assertions and explicit second confirmation remain required. Palette keyboard containment passes independently.

Parent execution: unit/transport suites, Manage browser contracts, chat reveal regression, Shell navigation regression, lint, TypeScript/Vite build, browser self-tests, full browser suite, publisher tests and whitespace validation passed. Lint exits zero with warnings, not warning-free. Dependency audit reports zero vulnerabilities.

`evidence/browser/report.json` contains **15 passed journeys** and **54 screenshots**, including new-conversation/list reopening, Manage context, approval, palette and transport audit. The self-test retains **26 negative/control checks**. Publisher tests pass **31 cases**. A separate clean lockfile install/rebuild produced all **11 artifact files byte-identically**. Parent visually reviewed Home, Chat, Manage and Workspace; no blocking visual defect was found. Minor gutter/composer polish and physical-device accessibility remain limitations, not waived test failures.

The guarded publication dry-run passed without writing the live tree. Manifest digest: `d12b1de9b6d96f63d25a92d85a73f994f6fc0152697143eebe0108976fc1f157`; candidate entry digest: `9783bf21c838108f53e837f1dcf307631f7100a09096ccfebe0048ea5b4c9fd0`. This approves source publication and subsequent static-only cutover after remote CI passes. It does **not** certify full Desktop parity, authenticated live integration or physical-phone behavior.
