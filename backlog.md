# Hermes Mobile backlog

Canonical local task queue (workspace workflow default; no external issue tracker configured).

## HM-UX-01 — Official Desktop parity inventory [complete: structural/source evidence]
- Shape: ship (local documentation + validator artifact, not publication).
- Owner approval: “oke gas” following proposal to build a replacement candidate beside current app, review flow before porting.
- Scope: action-oriented inventory at upstream `9dd6634c5635321cf38840cc30e9b51226689128`, stable release separately pinned. Official built-ins including bundled Bot Mode/Kanban/Accent; exclude custom plugins. Honest incomplete/unverified flags; no claim of exhaustive parity without source enumeration.
- Owner/profile: builder with source-audit responsibility. Isolated worktree `~/workspace/.worktrees/hermes-mobile/parity-inventory`.
- Outputs: `docs/parity/features.json`, `upstream-lock.json`, `README.md`, `native-boundaries.md`, and `app/scripts/check-parity.mjs` with negative fixture tests.
- Acceptance: source paths/symbols backed by pinned upstream; unique IDs; valid status and scope; prototype destination mapping; validator passes actual inventory and rejects malformed fixtures. No fictitious tested/verified feature states.

## HM-UX-02 — Mobile replacement prototype pair [complete: ready for Owner review]
- Shape: ship (local interactive design artifact).
- Owner/profile: studio. Isolated worktree `~/workspace/.worktrees/hermes-mobile/mobile-prototype`.
- Input: saved plan `.hermes/plans/2026-09-05_224018-desktop-parity-mobile-ux.md` plus current explicit Owner permission to rethink layout; older V2 remains reference, not constraint on new candidates.
- Outputs: `design/parity-shell/index.html`, `design/parity-workspace/index.html`, `design/parity-compare/index.html`, documented route manifest.
- Acceptance: two STRUCTURALLY different navigation systems, not reskins; same content and chat baseline; clickable flows for resume/chat/files/diff/approval/bot/routine/manage and all documented feature-family destinations. English UI, obvious mock-data banner, no real auth/network/execution, full source labels for native blockers. Offline/failed/empty states, useful back/context behavior and preserved draft. Existing app/design files untouched.

## HM-UX-03 — QA and preview delivery [QA/preview verified; source branch ready]
- Shape: ship (deterministic validation and evidence).
- Owner/profile: builder for browser/test execution; separate standards/spec reviewers; default final gate.
- Outputs: reusable no-new-dependency checks, viewport screenshots and receipt, final file entry point.
- Acceptance: actual Chrome flow checks; no page overflow at 360/390/430 and narrow smoke; 44px targets; native blockers not faked; no console errors; screenshot review; existing bot/resume checks still pass; no tracked app production code diff. Record untested real iOS/Android and accessibility limits honestly.
- Publication: Owner explicitly approved preview publishing in NEW subfolders under existing Tailnet `https://nuc.tailcf7779.ts.net:8450/` and commit/push on a separate prototype branch AFTER validation. Live app `:8451` / `app/dist` remains untouched; no new service/port or Tailscale routing changes. Worktrees retained until Owner approves cleanup.

## Milestone gate and execution budget
- Gap: current client omits broad Desktop management/workspace features and has ambiguous navigation context; Desktop Electron is not a usable phone UI, and browser dashboard is a different product surface.
- Goal: a usable review package, not a full-parity runtime implementation. Success: validated action inventory + two working comparison candidates + reproducible QA receipt.
- Stages: pinned sources -> inventory/validator (builder); plan/reference -> two local prototypes (studio); artifacts -> Chrome flow/visual receipt (builder); results -> reviewed package (default); package -> design selection (Owner).
- State/source of truth: this queue, saved plan, `docs/parity/`, `design/parity-*`; runtime state remains untouched on gateways.
- Validators: schema/source-pin checks + malformed fixture rejection, DOM/interaction assertions and viewport screenshots; human visual/spec review remains mandatory.
- Failure/retry: at most two official fetch retries then alternate official source or blocked row; test failure stops integration, bounded correction pass; never claim mocked data as runtime proof.
- Rollback: artifacts are additive in isolated worktrees; main production code untouched. No destructive cleanup, deployment revert or backup/restore.
- Authority: local prototype/test work and additive preview publication + separate-branch commit/push are Owner-approved. Chosen architecture/app migration, production/runtime mutations, other publishing/access/spending still require separate approval.
- Models: specialists used active runtime gpt-6-astra/openai-codex for inventory, design, QA and two bounded reviews; scoped corrections closed the findings. Delivery needed an additional bounded static-host URL adapter and test-fixture throttle diagnosis, with no service changes. No further design direction or model escalation is authorized by this milestone. Deterministic validation uses no model; no stage-specific system prompt files.
- Cost/cadence: one-shot local development, no cron, external paid service, new package install, or live agent prompt. No monetary cost estimate claimed because token pricing/budget not measured here.
- Evidence: inventory + 33 negative fixtures pass; all 49 pinned sources checked; final browser suites pass (1,246 baseline checks and 324 extended checks), 6 URL adapter cases pass, independent review findings closed by RED/GREEN regressions. Preview HTTPS rendering and five file hashes verified; live app hash unchanged. Receipt: `docs/parity/review-receipt.md`. Next product gate is Owner design choice, not app cutover.
