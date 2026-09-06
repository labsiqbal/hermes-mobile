# HM-UX-04 independent review record

Baseline: `de9c5d1b7272fb6ab3204370357d955dad9dbd06`. Concurrent-integration review of the real client, not a prototype. Findings below were reproduced with fictional transport. **Final review PASS**: the closure section supersedes historical pending statuses; source/CI/publication delivery is recorded separately in `chat-cron-release.md`.

## Standards axis

- **S1 / P1: unknown canonical identity allowed protected deletion.** A null roster canonical reference was treated as absence. Parent executed `/tmp/hm-ux04-standards-repro.mjs` and observed a canonical target deleted. Builder added exact canonical lookup with failure protection. Later parent adapter reproduction observed zero writes and one exact lookup; actual-component final regression pending.
- **S2 / P2: stale deletion confirmation survived disconnect/reconnect.** Parent actual-component reproduction kept the dialog and dispatched the old confirmation after reconnect. Pending final positive regression for cancellation and pre-dispatch invalidation.
- **S3 / P2: hydrated project history duplicated Recent.** Different overview/drill-in horizons rendered the same owner/session twice. Parent actual-component reproduction counted two rows. Source membership now incorporates hydrated IDs; later parent adapter/membership reproduction had no overlap. Final actual-component regression pending.

No speculative smell/refactor findings were retained. Detailed original report/reproduction: `/tmp/hm-ux04-standards-review.md`, `/tmp/hm-ux04-standards-repro.mjs`, `/tmp/hm-ux04-standards-fixture.tsx`.

### Parent positive component verification

Parent subsequently executed `/tmp/hm-ux04-parent-review.mjs` against actual ChatList/ChatSource/ManagementClient with fictional transport. Result `/tmp/hm-ux04-parent-review.json`: one project-row occurrence, zero canonical writes, stale dialog absent after disconnect/reconnect, a fresh confirmation deletes only `old-project` in `builder`; no browser diagnostics, Chrome exited and disposable profile removed. This supersedes the pending actual-component status for S1/S2/S3 above. The durable regression and full release suite still need final validation.

## Spec axis

- **F1 / P1: valid REST pagination rejected.** Pinned backfill can exceed the page limit and repeat on other pages; total includes hidden roots excluded from returned rows. Initial strict visible-count equality incorrectly hid profile history. Parent read the pinned implementation and reran the source-derived fixture: now returns 101 unique rows with backfilled pin and one visible row where total is two. Final durable regression pending.
- **F4 / P2: project hydration failure stranded verified history.** A valid REST session remained excluded from Recent by overview membership while its project displayed only a hydration error. Parent reproduced the source/membership failure; correction and final actual-component regression pending.
- Whole-tree and synthetic Home hydration failure previously discarded verified history; source corrections now preserve rows with warnings. Canonical uncertainty and duplicate membership overlap Standards findings above.

Detailed report: `/tmp/hm-ux04-spec-review.md`; parent reran `/tmp/hm-ux04-spec-repro.mjs` (seven source/adapter observations, not seven UI journeys). Reproduction scripts intentionally asserted some historical failures; exit zero alone does not establish their closure.

## Review boundaries

Existing fixture warnings/stale test integration were not treated as final release findings before implementation finished. Root labels, model placement, responsive layout, full built-app journeys and final durable tests still require the final gate. No real deletion, cron action, gateway prompt, credentials or runtime publication occurred during review.

## Final independent closure — PASS

The parent reran the complete frozen candidate gates after the two correction rounds and approved the final picker, Chats, deletion dialog and Cronjobs screenshots. The release executor independently verified all 74 source/build/test/deploy input hashes and all 13 artifact hashes against the frozen maps. Features, production and navigation reports identify those exact artifact bytes. Durable, secret-free evidence: [`evidence/chat-cron-frozen-gates.json`](evidence/chat-cron-frozen-gates.json).

| Finding | Final positive evidence | Verdict |
|---|---|---|
| S1 canonical uncertainty | StrictMode actual-component regression invokes exact lookup for null roster canonical identity and prevents protected deletion; fresh allowed confirmation remains exact-owner/session | PASS |
| S2 reconnect stale confirmation | Dialog is cancelled across disconnect/reconnect; only a newly confirmed exact target can dispatch | PASS |
| S3 hydrated Recent duplication | Different overview/hydration horizons produce one owner/session occurrence | PASS |
| F1 source-backed pagination | Parent source regression accepts pinned backfill/repetition and hidden-root total mismatch; final unit/source gate passed (22 source checks) | PASS |
| F4 hydration failure recovery | Actual-component regression retains accessible verified preview with an explicit warning | PASS |

Frozen reports: 17 chat/cron checks, 6 review regressions, 15 production journeys, 26 harness self-tests, 2 navigation journeys; real ChatView reveal 11 scenarios. Browser diagnostics and fixture violations are empty, and disposable Chrome profiles were removed. Geometry assertions verify model 44px targets and Cronjobs 16px gutters/44px select at 360/390/430. Parent visual signoff is supplied independently of these numeric assertions.

All retained Standards/Spec findings are closed within the approved scope; no source correction remains. The approved running-profile-only deletion restriction is retained, not waived. Review does not establish authenticated live compatibility, physical-device behavior, complete Desktop parity, or global deletion concurrency safety. No live mutation was used by review or release validation.
