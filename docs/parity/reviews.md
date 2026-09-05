# Independent review record

Review baseline: `9b25ec831e144ff5182978002d4bbb2ddb6521f1`; additive prototype/inventory/test package, not app runtime implementation.

## Standards

Initial review: 3 actionable P2 findings, no judgment-only smells worth action for this self-contained prototype scope.

1. Back restores route but not conversation identity after switching from a project chat to a bot chat. `design/parity-shell/index.html:44–46,112` and matching workspace candidate.
2. Direct-entry Back oscillates Preview → Files → Preview because synthetic parent navigation pushes rather than replaces history.
3. Baseline approval QA accepts an immediate resolution when both the confirmation control and modal are missing. Prototypes themselves already require confirmation.

The reviewer reproduced navigation with unchanged inline code in DOM/history adapters and the approval gap with a negative fixture; that part was not browser evidence. The Spec reviewer independently reproduced the conversation bug in Chrome.

## Spec

Initial review: 1 P1 and 2 P2 findings; no unasked runtime implementation or production-app changes.

1. P1: Back restores the wrong conversation/draft (same issue as Standards finding 1).
2. P2: a global model value leaks a session model selection across gateway/profile/conversation contexts.
3. P2: bot roster/detail ownership labels conflict with active Harbor/research context.

Spec review used targeted Chrome probes in both candidates; no all-green claim.

## Correction gate

Closed by the final bounded correction and manager recheck. The four UI regressions failed in both candidates before correction (8 failures), then passed in actual Chrome. The missing-confirmation negative fixture also failed before the QA correction and is now rejected correctly. Final parent execution: baseline 1,246 checks / 129 cases, extended 324 checks / 232 route-viewport cases / 58 pointer palette destinations, all with zero failures. Source hashes were stable before/after execution. Initial review findings were not erased: closure is supported by regression evidence and manager source/visual review, not a claimed second independent reviewer pass.

Evidence: `evidence/regression-red.json`, `evidence/confirmation-red.json`, `evidence/harness-self-test.json`, `evidence/browser/report.json`, `evidence/browser/extended-report.json`, and `evidence/validated-inputs.json`. Preview publication gate is open; production app migration still needs Owner design approval.

Line references describe the reviewed snapshot and may shift during correction. Duplicate findings remain listed under their original axis so one review does not mask another.
