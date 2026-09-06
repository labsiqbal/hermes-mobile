# HM-UX-08 — Chats row readability

## Scope and gate
Owner requested a narrow real-phone correction (“bro cramped gini layoutnya coba fix dong biar enak di liat”), then authorized delivery with “livein”. Builder source/artifact verification precedes independent parent visual/quality review; only after approval may the existing source/CI/guarded :8451 publication pipeline run. No gateway/auth/transport/cache/ownership changes or other-root/composer redesign. No new application state or dependencies; two bounded correction rounds, no model escalation, one-shot work. No live prompts, session deletes, credential reads or service changes.

The isolated branch is `fix/chats-row-readability`, worktree `/home/iqbal/workspace/.worktrees/hermes-mobile/chats-row-readability`. Its base is verified PR7 merge `c7d5483bbe9bf2213c6bd849ba2640c6064f6367`, app-source-equivalent to `67359166ede295d3ffb8e48e6513ef2cda3bebd7` (native fetch binding and global appearance both present). Current main `cf713474303b343e5b38db320f0f895bcb811b79` adds only prior release receipts; those are not edited by this task. Parent must preserve that history during integration. Canonical `app/dist` was never built or written. Dependencies reused through an isolated worktree symlink; no install.

## Diagnosis before patch
Owner screenshot `/tmp/herdr-clipboard-images-1001/client-4-clipboard-1788675518527001164-0.png` was visually inspected. It demonstrates competing initial/avatar, title, timestamp/count and delete columns with repeated framed actions. It does not establish the chosen UI scale.

Ranked hypotheses and probes:
1. Fixed sibling columns consume the title's width. Built geometry confirmed a 151.34px title at Standard/390 and 65.44px at Large/320.
2. Shared `.rowcard-title` nowrap/ellipsis prevents useful wrapping. Computed styles confirmed it across all three scales.
3. Groups overlays rows. Disproved: list starts at Groups bottom, row displacement equals scrollTop, shell bounds remain fixed and the last row is reachable. Partial rows at the scroll edge are normal; the two-line Groups link merely consumes excessive viewport (71.5px Standard, 89.125px Large).

The exact final runner was written and run before source edits: 27 failed assertions out of 47, with all scroll-boundary and protection checks already passing. Baseline built only in this lane, preserved at `/tmp/hmux08-baseline-app/dist` with screenshots/report `/tmp/hmux08-baseline/`. This is deterministic fixture evidence, not authenticated phone evidence.

## Narrow implementation
- Remove redundant initial avatars only from Chats session rows; title uses the available width and wraps up to two lines. Full title remains in accessible button content.
- Keep preview and profile/time/message-count/canonical-or-active markers underneath; metadata wraps rather than losing its semantic data. Existing title, ownership and activity derivation are unchanged.
- Keep explicit separate delete and pin controls, each 44px, but remove repeated decorative frames. Focus styles and selected-pin color remain. Deletion availability, confirmation, owner preflight and exact readback are untouched; pins remain local display ordering only.
- Compact Groups to one row with its description retained in the accessible name. Same navigation, fixed normal-flow position and list scroll owner; no new controls, dropdowns, search or swipe-only actions.
- First candidate passed 46/47; narrow Large metadata wrapping exceeded the row-height budget. One correction grouped timestamp/count, reduced metadata gaps and adjusted row padding. Final runner is unchanged and passes 47/47. No tests were relaxed.

At Standard/390, title width is now 298px and Groups is 48px tall. At Large/320, title width is 226px and Groups is 60px tall. The existing global density and editor/target safety floors remain intact.

## Evidence and review entry points
`evidence/chats-row-readability.json` binds reports, screenshot paths, runner SHA-256 and built artifact hashes. Frozen staged source and task-only rollback patch: `/tmp/hmux08-frozen-source.json`, `/tmp/hmux08-candidate.patch`. Parent reviews the frozen candidate before source delivery; builder performed no commit, push or publication.

Readability gate: 31 varied fictional rows in the actual built App; 75/100/125 at 320/390/430; expanded project sections, Recent, non-row-aligned scrolling, end reachability, >=44px controls, title/meta hierarchy, protected canonical/other-profile rows and cancel confirmation. Identical RED/GREEN runner: baseline 27 failures / 47 checks, final 47/47; 27 screenshots per run. Screenshot images contain no metrics overlays.

Recommended screenshot paths under `/tmp/hmux08-candidate-final/`:
- `100-390-top.png`, `100-390-recent.png`, `100-390-scrolled.png`
- `125-320-recent.png` (narrow Large)
- `75-390-top.png` (Compact expanded projects)

Preserved regression checks: native fetch17, features17, review6, appearance466, layout62, production15 and harness selftest26 pass. Full unit tests, lint and production build pass; lint retains the same seven baseline warnings. Final rebuild has identical bytes to the candidate, native, features, appearance, layout and production built-browser receipts. Legacy review6 is a real-component fixture without a built-asset manifest, not a native transport claim. Log: `/tmp/hmux08-build-unit-lint.log`.

The existing CI workflow runs the new readability script without removing any old gate. Native-fetch and appearance runners were not modified. Earlier release evidence is untouched. Source rollback is the isolated task patch; runtime rollback is not automatic. All browser traffic used disposable fixtures and closed loopback-only harnesses/CDP pipes. Physical iOS/Android/safe-area and authenticated gateway acceptance remain unverified until actual owner testing.
