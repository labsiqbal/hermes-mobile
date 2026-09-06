# HM-UX-05 — Mobile layout overlap correction

Status: builder gates passed; parent independently reviewed all four fixes visually and reran all 62 layout checks successfully. Owner approved “Ya, lanjut sampai live” for HM-UX-05. The release executor verified frozen identity and a clean isolated lockfile rebuild (all 13 deployable files byte-identical), then reran 62/62 layout checks. Source delivery/publication progress is recorded separately in [the release receipt](layout-overlap-release.md). This correction report is fixture evidence, not physical-device or authenticated production proof.

## Scope and causes

Baseline: `7606cf293be4074f82c8ab8ac4270c0e733028f5`, branch `fix/mobile-layout-overlap`, exclusive worktree `/home/iqbal/workspace/.worktrees/hermes-mobile/layout-overlap`.

The four Owner images are under `/tmp/herdr-clipboard-images-1001/`:

| Image | Root cause and source | Correction |
|---|---|---|
| `client-4-clipboard-1788661867288299039-0.png` | `app/src/screens/ChatView.tsx` rendered jump-bottom as a screen sibling; `chat-view.css` positioned it at a fixed 78px bottom offset. That assumed a one-line composer without its Workspace/model rows. The universal 44px minimum also made its actual target larger than the nominal 36px circle. | Move the unchanged jump action inside the positioned composer wrapper and anchor it above the **entire** wrapper with `bottom: calc(100% + 8px)`. Center the 44px target in the transcript rather than over the top-right model pill. No measured-height JS or guessed composer spacer. The model target and model configuration behavior are unchanged. |
| `client-4-clipboard-1788661871841343669-0.png` | `ChatView.tsx` retained `search-wrap` / `search-icon` classes with no remaining generic style definitions. The span/SVG took a separate line above a full-width field; the sticky wrapper used the darker page background. | Give `.model-sheet-search` its own aligned flex row and themed field surface; its nonshrinking icon and shrinking 16px input share one row. Sticky search, filtering, model caps and reasoning chips remain unchanged. |
| `client-4-clipboard-1788661881904190958-0.png` | `app/src/components/MessageContent.tsx` already renders Copy and `pre` as siblings, but `chat-view.css` absolutely positioned Copy over the `pre` with no reserved region. The global 44px target made the conflict larger. | Use a column layout with Copy in its own normal-flow, right-aligned control row. Keep the `pre` independently horizontally scrollable, `white-space: pre`, with 12px text padding and `min-width: 0`. The existing clipboard function still copies only the `pre`, never the Copy label. No renderer or clipboard semantics change was needed. |
| `client-4-clipboard-1788661923109020227-0.png` | `Manage.tsx` returns a plain `.manage` directly inside `App.tsx`'s `.shell-body`. `.manage` had zero horizontal padding and no bounded scrolling; `.shell-body` itself is not scrollable. Content could overflow the shell, and native `scrollIntoView` displaced the header/tab frame. | Manage owns safe horizontal gutters `max(16px, env(safe-area-inset-*))` and, only as a direct shell child, a bounded flex scroll area. The shell still supplies the single Header and TabBar. `Cronjobs.tsx` shares Manage presentation but retains its more-specific `.body.manage.cronjobs` padding, so it receives 16px rather than doubled gutters. |

Sibling tracing covered all `MessageContent` usages (restored/live assistant and user Markdown), group ChatView use, Workspace's mounted-chat sibling, `.model-sheet-search`'s sole usage, the shared Manage panels/error surface, and Cronjobs' reuse of `manage.css`/`SchedulesPanel`. No auth, session, profile, cwd, pin, deletion, cron mutation, or backend contract code changed.

## RED → GREEN evidence

Final runner: `app/scripts/check-layout-overlap-browser.mjs`. It reuses the existing `ProductionBrowser`, `serveDist`, `Journeys`, CDP pipe and guarded fictional transport fixture. The only shared fixture addition is an optional session-history payload override, used to restore real Markdown with a short URL, long unbroken URL and multiline code followed by a long transcript. It does not replace React state or the production App.

- RED: `/tmp/hm-layout-overlap-red-verified/report.json` — **48 failed / 14 passed** out of 62 checks, expected exit 1, all four symptom families reproduced.
- GREEN: `/tmp/hm-layout-overlap-green-verified/report.json` — **62 passed**, exit 0.
- Both runs contain 60 screenshots, complete geometry and built-file hashes, no unexpected browser/transport diagnostics, and successful browser/profile/server cleanup.
- The initial baseline dry run preceded all application fixes (`/tmp/hm-layout-overlap-red-final/report.json`). Final RED was repeated using the exact final runner against a baseline-only source export/build at `/tmp/hm-layout-overlap-baseline-source/app`; canonical `app/dist` was never used or changed.

The matrix covers widths **320, 360, 390, 430**, each at **844 and 480px height**. Every chat combination restores long history, scrolls away, and measures both one-line and five-line drafts. It checks all pairwise jump/model/composer/Workspace rectangles, five interior hit samples, 44px targets, upper-right model placement, viewport containment, real jump-to-bottom action, search icon/input centers and search behavior, short/long code/control regions, actual horizontal scrolling and exact copied strings. Manage root and Profiles detail check 16px outer gutters, one header/tab frame, bounded scrolling and frame geometry. Cronjobs checks the same non-doubled gutter/frame contract at all four widths.

### Exact representative measurements

These values come from each report's `layout` entries, not image estimates:

| Check | Before | After |
|---|---|---|
| `composer-390x844-single` | Jump `(330,722)–(374,766)` intersects model `(218.265625,730)–(376,774)`; model hit samples fail. | Jump `(173,628)–(217,672)`; model unchanged. Every tested pair is disjoint; jump/model hit samples pass. |
| `composer-390x480-multiline` | Jump y=358–402 intersects composer y=326–470. | Jump y=176–220, model y=278–322, composer y=326–470; 132px textarea. No pair intersects. |
| `search-390x844` | Icon y=469–484, input y=490–534; wrapper `rgb(16,17,19)`, separate 76px stack. | Icon y=510.5–525.5, input y=495–541; same center, 8px horizontal gap, 46px input target. Wrapper matches `rgb(25,27,31)` themed composer surface. |
| `code-390x844` | Both `pre` regions intersect Copy; long URL text extends beneath its control. | First Copy y=104–148, first code text y=162–176. Second Copy ends at y=252.59375, second text begins y=266.59375. Long `pre` scroll width 3940px within 348px client width; page remains 390px. |
| `manage-root-390x844` | Hero/scope/row left and right gutters 0px; overflow visible; root scroll displaced header top to -97px and tabs bottom to 747px. | All three have 16px gutters. Header y=0–97, Manage scroll area y=97–784, tabs y=784–844. |
| `manage-detail-390x844` | Title/scope/row gutters 0px, overflow visible. | All three have 16px gutters, overflow auto, one unchanged shell frame. |

### Screenshot pairs for independent review

Use the same filename under `/tmp/hm-layout-overlap-red-verified/` and `/tmp/hm-layout-overlap-green-verified/`:

- `composer-390x844-single.png`
- `composer-390x480-multiline.png`
- `search-390x844.png` and `search-320x480.png`
- `code-390x844.png`, `code-320x844.png`, `code-scrolled-320x844.png`
- `manage-root-390x844.png` and `manage-detail-320x480.png`
- `cronjobs-320.png`

These show the actual trigger states, not just a bottom-pinned chat with hidden problems. Builder visually inspected the Owner images and representative built-app before/after screenshots. The parent subsequently performed the independent visual review of all four fixes and independently ran `/tmp/hm-layout-overlap-parent/report.json`: 62/62 passed. This is parent-attributed review, not a visual-review claim by the release executor.

## Verification receipts

All commands run from the isolated `app` directory unless noted.

| Gate | Result / receipt |
|---|---|
| `npm run test:unit` | Passed, `/tmp/hm-layout-overlap-unit-final.log` |
| `npm run lint` | Exit 0; **7 pre-existing warnings**, no new warning; `/tmp/hm-layout-overlap-lint-final.log`. Baseline comparison: `/tmp/hm-layout-overlap-baseline-lint.log`. |
| `npm run build` | TypeScript + Vite passed; `/tmp/hm-layout-overlap-build-final.log` |
| `node scripts/check-chat-cron-browser.mjs /tmp/hm-layout-overlap-features` | 17 passed; `report.json` in that output directory |
| `node scripts/check-chat-review-browser.mjs /tmp/hm-layout-overlap-review` | 6 passed; `report.json` |
| `node scripts/check-production-browser.mjs --app-dir . --output /tmp/hm-layout-overlap-production` | 15 mandatory journeys passed; `report.json` |
| `node scripts/check-production-browser.mjs --app-dir . --self-test --output /tmp/hm-layout-overlap-selftest` | 26 canaries passed; `self-test.json` |
| `node scripts/check-shell-navigation.mjs /tmp/hm-layout-overlap-navigation` | 2 journeys passed; `report.json` |
| `npm run check:chat-reveal` | 11 passed; `/tmp/hm-chat-reveal-QqTZZ6/report.json`, `/tmp/hm-layout-overlap-reveal.log` |
| `npm run check:management:browser` | Transport and actual component checks at 360/390/430 passed; `/tmp/hm-layout-overlap-management.log` |

Run the new gate with `npm run check:layout-overlap:browser -- /tmp/hm-layout-overlap-reviewer`. An optional second runner argument selects another isolated app directory containing `dist`, allowing the identical gate to test baseline and candidate. The existing CI pipeline now runs it and collects its output beneath the existing production-browser artifact directory. No new dependency or release pipeline was introduced.

Frozen built entry: `app/dist/index.html`, SHA-256 `1fa8bc2fd6d267f6dd58be5cf0c813ff7f739b1ad2b5391f14dfd179b19dfb91`. The full 13-file manifest is embedded in the GREEN report. Source/checksum/whitespace receipt: `/tmp/hm-layout-overlap-frozen-source.json` (created after explicit staging).

## Corrections and limits

One application correction after the first patch was needed: visual review caught Manage's previously missing scroll ownership, not just the missing gutters. `/tmp/hm-layout-overlap-manage-scroll-red/report.json` records that RED before the scoped scroll fix. No second application correction was needed.

Harness calibration is documented separately: the early runner used an incorrect tab selector and a button-as-scope lookup; initial hit samples touched the outside corners of a circle. Final samples cover its center and four interior cardinal points, while full bounding-box intersection assertions remain. CDP metrics changes also precede the app's `visualViewport` resize callback; the final runner waits for the requested actual root height before measuring. The final identical runner was executed against both baseline and candidate after these corrections; no failure was hidden by extending deadlines or relaxing layout criteria.

All history, model names, credentials, URLs, clipboard writes, management data and transports in these fixture tests are explicitly fictional and isolated to disposable browsers. The broader existing suites include their own permitted fictional writes; no real prompt, cron action, session deletion, runtime authentication, profile change or environment/secret read was performed. Physical iOS/Android keyboards, nonzero device safe-area insets and assistive technology remain unverified. The 480px viewport is only a deterministic keyboard-height approximation. Parent review and Owner publication authorization have passed; live delivery evidence belongs to the separate release receipt.
