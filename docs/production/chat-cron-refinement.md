# HM-UX-04 — Chats and Cronjobs refinement

## Delivery status

**Implementation, frozen parent gates and independent review passed.** Builder did not commit or publish. The release executor owns the separately authorized delivery; see [release receipt](chat-cron-release.md) for current source/CI/live status.

- Worktree: `/home/iqbal/workspace/.worktrees/hermes-mobile/chat-cron-refinement`
- Branch: `feat/chat-cron-refinement`; baseline `de9c5d1b7272fb6ab3204370357d955dad9dbd06`.
- Scope/approval: [acceptance contract](chat-cron-acceptance.md), [source audit](chat-cron-source-audit.md), [independent review](chat-cron-review.md).
- Durable candidate evidence: [`evidence/chat-cron-builder-final.json`](evidence/chat-cron-builder-final.json). This records actual checks, artifact hashes, raw receipt locations and browser cleanup. Historical release receipts and `validated-inputs` are unchanged.

## Implemented behavior

- **Model control:** compact visual pill above the composer at the right edge, outside the header; model/reasoning wire behavior retained. Actual bounding box is 44px high at 360/390/430px; sheet-open and sheet-closed screenshots recorded.
- **Chats:** flat, no-search real project/Recent structure. Synthetic Home and empty project groups are hidden, not their otherwise-visible sessions. Multiple independent project pins persist per gateway ID + endpoint; project keys include profile. Pins change ordering only and are removed by the existing local-data wipe.
- **Filters:** Project + Profile combine, with a separate canonical Bot chats type. Server-owned canonical IDs and aliases identify bots; misleading titles do not. Overlapping IDs in different profiles remain distinct. Navigation retains actual profile and scoped draft identity. Expanded project hydration participates in Recent deduplication and invalidates after refresh/deletion/reconnect.
- **Deletion:** explicit dialog names gateway/profile/exact stored ID. Cancellation performs no delete; preflight cancellation/disconnection cannot dispatch. Only inactive sessions owned by the verified running profile are enabled. Other profiles and canonical Bot Chat are protected, including null/failed roster canonical lookups. Exact acknowledgment plus exact-target 404 readback establishes the displayed success; malformed responses, transport loss, or failed verification report an unknown outcome. No mutation fallback or automatic retry.
- **Cronjobs:** visible root/header/palette labels replace Activity; internal `activity` route remains compatible. Reuses `ManagementClient.schedules` and the existing `SchedulesPanel`: schedule/status, ID, profile, enabled, next/last server timestamps where present, refresh, empty/error/unsupported states. Runs remains reachable with a return to Cronjobs. Profile selection does not bypass source scope guards. The scrollable surface has 16px gutters and a themed 44px profile select at all three tested mobile widths.
- **Explicitly absent:** move-session, remove-from-project, cwd/profile reassignment, new dependencies, Hermes core changes, cron mutation controls, invented cross-profile cron support.

## Source and safety boundaries

Pinned official source: `9dd6634c5635321cf38840cc30e9b51226689128`.

`ChatSource` composes roster/canonical references, REST owner-echo history and profile-stamped project RPC results. It does not infer ownership from requested scope, title or a missing default. Explicit literal `default` is serialized, including message history on named-process gateways. REST pagination handles source-backed pinned backfill and hidden roots in totals; changing totals, invalid/ownerless rows and repeated unpinned pages fail visibly. The scan is bounded at 5,000 sessions; tree/hydration retain upstream visibility/window limits. This is not an exhaustive database inventory.

The RPC resolver can fall back to the launch profile if another profile disappears. The approved running-profile-only deletion boundary avoids claiming safe general cross-profile deletion. Preflight checks are not atomic; upstream process-local live checks and cascade behavior are not a global concurrency guarantee. Stored target deletion does not imply disk erasure or deletion of every branch/compression continuation; the dialog says these may remain.

Unsupported projects retain independently verified history. A failed individual hydration shows verified preview with an explicit warning rather than silently claiming complete history. Canonical roster null is uncertainty, not authorization to delete; exact lookup errors fail closed.

Cron reads without owner echoes retain the existing running-profile scope handshake. Unsupported selections show an error and no schedule rows; no guessed schema or alternative endpoint is introduced. Read-class APIs may perform upstream maintenance (auto-archive, canonical unarchive, project cache reconciliation); local display-only pins themselves send no mutation.

## Final executed gates

All commands ran in the isolated worktree, using fictional transport only. Counts below retain each suite's own unit; they are not combined into a misleading overall assertion total.

| Gate | Result | Raw evidence |
|---|---|---|
| `npm run test:unit` | PASS: identity/preferences 9 assertions; chat source 22 checks; bots/resume/shell state/management PASS; Workspace 20 tests plus 37 browser checks at each of 360/390/430 | `/tmp/hm-ux04-final/unit.log` |
| `npm run lint` | Exit 0; 7 warnings in existing smoke/icons/Bots/Runs/Rooms/Groups/ChatView locations, not warning-free | `/tmp/hm-ux04-final/lint.log` |
| `npm run build` | PASS TypeScript + isolated Vite production build | `/tmp/hm-ux04-final/build.log` |
| `node scripts/check-chat-cron-browser.mjs /tmp/hm-ux04-chat-cron-final` | PASS 17 recorded checks, 7 layout audits, 11 screenshots; no diagnostics/fixture violations | `/tmp/hm-ux04-chat-cron-final/report.json` |
| `node scripts/check-chat-review-browser.mjs /tmp/hm-ux04-review-final` | PASS 6 real-component regressions under StrictMode | `/tmp/hm-ux04-review-final/report.json` |
| `npm run check:management:browser` | PASS real components at 360/390/430; transport/confirmation/scope/44px checks | `/tmp/hm-ux04-management.log` |
| `npm run check:chat-reveal` | PASS 11 scenarios | `/tmp/hm-ux04-reveal.log`; `/tmp/hm-chat-reveal-C9pn0p/report.json` |
| `node scripts/check-shell-navigation.mjs /tmp/hm-ux04-navigation-final` | PASS 2 navigation journeys | `/tmp/hm-ux04-navigation-final/report.json` |
| `node scripts/check-production-browser.mjs --app-dir . --output /tmp/hm-ux04-production-final` | PASS 15 journeys, 28 layout audits, 54 screenshots | `/tmp/hm-ux04-production-final/report.json` |
| `node scripts/check-production-browser.mjs --app-dir . --self-test --output /tmp/hm-ux04-selftest-final` | PASS 26 positive/negative harness cases | `/tmp/hm-ux04-selftest-final/self-test.json` |
| `python3 -m unittest discover -s deploy -p 'test_publish_static.py' -v` (repo root) | PASS 31 tests, fixture publisher only | `/tmp/hm-ux04-publisher.log` |
| `git diff --check` | PASS | Final local command; no whitespace errors |

The dedicated chat/cron, production and navigation reports contain identical final artifact hash lists. Candidate `app/dist/index.html` SHA-256: `5cbef665628f4794df76437fd80c3145b95e729784d3348a68bf6e94649687c7`. This identifies local tested bytes, not deployed bytes or a new approval manifest.

### Screenshots and geometry

Under `/tmp/hm-ux04-chat-cron-final/`:

- `model-closed-360.png`, `model-closed-390.png`, `model-closed-430.png`: above-composer, right-edge difference 0px; target height 44px.
- `model-open-360.png`, `model-open-390.png`, `model-open-430.png`: retained picker/search/reasoning UI.
- `cronjobs-360.png`, `cronjobs-390.png`, `cronjobs-430.png`: 16px content/select gutters, 44px select, themed background and 8px radius, scrolling enabled.
- `delete-confirmation.png`, `chats-final.png`.

Builder visually inspected rendered Chats/model/Cronjobs, then corrected the flush Cronjobs inset/native select and added explicit geometry assertions. Final 390px Cronjobs screenshot was re-inspected after the correction; parent owns independent final visual signoff.

## Changes and durable regressions

- New adapters: `app/src/lib/chat-browser.ts`, `app/src/lib/chat-source.ts`.
- Updated transport: `app/src/lib/hermes-client.ts`, `app/src/lib/management-client.ts`.
- UI: `app/src/screens/ChatList.tsx`, `chat-list.css`, `ChatView.tsx`, `chat-view.css`, `Cronjobs.tsx`, `cronjobs.css`; shared `Manage.tsx` schedule export; `App.tsx`, `components/TabBar.tsx`, `lib/shell-state.ts` navigation.
- New tests: `app/scripts/check-chat-browser.mjs`, `check-chat-source.mjs`, `check-chat-cron-browser.mjs`, `check-chat-review-browser.mjs`, `fixtures/chat-review.tsx`.
- Existing fixture/gates updated without dropping Runs journeys: `production-browser-fixtures.mjs`, `check-production-browser.mjs`, `check-shell-render.mjs`; package scripts wire the new unit/browser commands.
- Documentation: this receipt, builder evidence JSON and accurate HM-UX-04 backlog state. Parent/scout acceptance, source-audit, review and preflight documents remain their own evidence.

Two bounded correction rounds addressed source pagination, canonical uncertainty, hydrated duplicate/history recovery, stale confirmation and StrictMode request cancellation, then final visual inset/select geometry. Durable tests check correct outcomes rather than merely replaying historical failure assertions.

## Remaining gates / limitations

No implementation test blocker remains. Parent independently reran frozen gates and approved final visuals; the release executor verified source/artifact identity and closed the review. Source/CI/static publication status is tracked in `chat-cron-release.md`. One builder, LAB source scout, INFRA read-only preflight and two independent review axes were used; parent also ran deterministic gates. Inherited model only, no paid service or runtime configuration change.

No live gateway prompts, deletes, cron actions, credentials or authenticated mutation smoke were used. Fixture output is not live compatibility proof. Physical iOS/Android, assistive technology and complete Desktop parity are unverified. No change to canonical served `app/dist`, historical release receipts or `validated-inputs`; no commit/push/merge/publish was performed by builder.
