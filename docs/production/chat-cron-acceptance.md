# HM-UX-04 acceptance and review contract

Owner confirmed: do not move sessions between projects; multiple project pins are allowed; rename Activity to Cronjobs. Implementation approved following the summarized scope. This document is acceptance criteria, not proof of completion.

Follow-up Owner decision after source audit: enable deletion only for the profile currently run by the gateway; other profiles and canonical Bot Chat are protected. This is an approved scope boundary, not a missing cross-profile delete feature. Cross-profile reading/filtering remains required.

Owner also explicitly authorized commit/push, CI-gated merge, and static-bundle update at the existing app URL after tests and review pass. No gateway restart, route/auth change, real test-session deletion, or cron mutation is authorized. Publication still requires the exact frozen artifact, guarded dry-run and served-byte verification.

| ID | Required observable outcome | Validator |
|---|---|---|
| CC-01 | Model pill visually compact, right aligned above input, not chat header; touch target at least 44px; existing model/reasoning wire stays session-scoped | Actual ChatView browser geometry + screenshots at 360/390/430; model wire regressions |
| CC-02 | Pin at least two projects, unpin independently, reload restores pins; unpinned ordering retains authoritative project order | Real ChatList interactions + local storage rehydration + gateway isolation |
| CC-03 | Pin only changes display preferences; no session move, membership removal, cwd/profile writes in any browsing control | Source diff plus deny-all unrelated mutation fixture audit |
| CC-04 | Project and Profile filters combine; Bot chats uses sourced canonical/type identity, not a title substring; same session is not duplicated within a view | Fixtures with two profiles, overlapping IDs, several projects and misleading titles; real component rendered membership |
| CC-05 | Project/Home/Recent completeness is truthful; hidden Home synthetic bucket does not swallow unclaimed sessions; hydrated groups invalidate after refresh/deletion | More than preview-limit fixture rows, expanded reload, deletion/reconnect refresh |
| CC-06 | Clearly discoverable deletion action; cancel sends no write; confirm dispatches exactly once for frozen owner/session identity; live/unsupported sessions remain guarded | Actual confirmation UI plus exact transport audit and failure/ambiguous-response cases |
| CC-07 | Session opened from any filter preserves profile and gateway; Back/Forward retains existing scoped drafts/history | Browser navigation plus duplicate IDs across profile fixtures |
| CC-08 | Cronjobs root shows real source-backed schedule list and useful detail/status; no invented global profile coverage | Actual component success/empty/offline/error/unsupported-scope fixture cases |
| CC-09 | Runs remain reachable with safe Back to Cronjobs; old Activity navigation identity may remain as compatibility alias but visible labels consistent | Built app root/palette/Home/Manage journeys and back navigation |
| CC-10 | Existing chat restoration, bot/group, model, approvals, Workspace and management safety gates remain intact | Full existing deterministic/browser gates; no weakened error/outbound/layout assertions |

## Authority and evidence boundaries

- Fixtures use fictional sessions and transport; no authenticated live deletes, prompts or cron changes. UI deletion is user-triggered, never executed by the implementation agent against real sessions.
- Browser preferences contain IDs only, no credentials or copied server session objects.
- Unsupported profile-addressing cannot silently fall back to the default profile. Unknown deletion outcome must not be presented as confirmed success or definitely unchanged.
- Source commit/push and final delivery are owned by default. Runtime static publication remains a separate validated-artifact gate; no service, routing or credential change.
- Preserve prior release evidence as historical records. New tests and receipt establish only this change's verified scope, not full Desktop parity or physical-device compatibility.
- Execution budget: one implementation builder, bounded LAB source audit and INFRA read-only preflight, plus separate Standards/Spec reviewers on the inherited model. Two correction rounds maximum; no model-tier escalation or new paid service. Parent owns final tests/delivery; a failing gate never becomes permission to weaken assertions.
