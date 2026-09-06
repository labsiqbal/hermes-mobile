# HM-UX-06 — Chats native reads and two-filter toolbar

Status: isolated source candidate; independent parent review and static publication remain gated. Baseline `f2f9ef9d052885ac75173a6db1e38fb99a937e9c`, branch `fix/chats-read-filters`. This document supersedes the HM-UX-04 Type/Bot dropdown recommendation, not canonical Bot Chat identity or the Bots root.

## Proven cause and narrow transport correction

`ManagementClient` captured unbound `globalThis.fetch`, then invoked it as `this.fetcher(...)`. Native Chrome validates the Window receiver: this throws `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` **before any HTTP request**. `errorFor` mapped that exception to the generic management failure shown for every profile. The working `HermesConnection.sessionMessages` path calls free/global fetch and does not have this receiver defect. Workspace already binds its default fetch; the sibling-wrapper audit found no other unbound stored default fetch in app source.

Builder and LAB independently reproduced the native receiver failure. LAB's actual-class reproduction returned the exact four screenshot messages, zero management requests and zero project-tree reads; injecting only bound native fetch reached all four fixture-owned profiles. This establishes a browser compatibility defect, not an authenticated deployed-gateway verdict. LAB source report: `/tmp/hm-chats-read-diagnosis.md`; original actual-class fixture and receipt: `/tmp/hm-chats-native-fetch-repro.mjs`, `/tmp/hm-chats-native-fetch-evidence/report.json`.

The correction binds **only the default** native fetch to `globalThis`; explicit injected test transports retain their contract. No endpoint, credentials, redirect policy, scope handshake, or RPC fallback was changed. Cookie-backed same-origin management reads remain the declared transport; bearer-only/nonbrowser forwarding is not newly supported. Never copy private auth fields to work around this defect.

### Why the old tests missed it

Node fetch and arrow-function `window.fetch` fixtures accept the receiver. Their successful session responses skipped the browser contract that failed on the phone. The new `check:chats-read:browser` runs the actual built App with **untouched native fetch**, fake in-memory WS, and CDP interception below the Web API. It asserts native identity, actual HTTP dispatch, literal default/named scope, owner-verified rows and subsequent project-tree reads. The intercepted responses are fictional and explicitly source-matched; no live gateway is contacted.

The initial baseline build failed native dispatch with no session GETs. A binding-only candidate passed that exact assertion while the toolbar/error-state checks remained red. The final identical runner is also run against the saved isolated baseline artifact; receipts contain asset hashes, results and cleanup. This separates actual transport repair from hiding the error UI.

## Read and ownership contracts retained

Pinned upstream `NousResearch/hermes-agent` at `9dd6634c5635321cf38840cc30e9b51226689128`:

- `hermes_cli/web_routers/sessions.py:165–222`: `GET /api/sessions` **without trailing slash**, explicit `profile`, `limit=100`, `offset`, `order=recent`, `archived=exclude`, `full=false`; response `{sessions,total,limit,offset}` with owner on every row. Existing query is correct; no URL switch was warranted.
- Profile validation, stable-total/pagination checks, pinned backfill deduplication, the bounded 5,000-session horizon and canonical root/tip identity remain enforced. A rejected page is never displayed. A later failure carries only already-projected, owner-validated complete pages as incomplete read evidence.
- `profiles/active.current` is the running process, not sticky `.active`. Failure to verify it disables deletion and is now disclosed even if history reads succeed.
- Project RPC rows still require matching owner. History read failure does not fall back to ownerless `session.list`. Tree membership is not inferred from titles or default scope.
- Existing delete confirmation, current-profile restriction, canonical lookup/protection, exact detail preflight, acknowledgment and exact 404 readback remain intact. Failed-owner or stale-roster rows cannot enable deletion. Exact verified deletion only evicts its cached row and invalidates older cache writes; no new remote mutation was added.

These reads can trigger documented upstream maintenance: listing auto-archive (`sessions.py:184–186`), canonical recovery, and project discovery-cache reconciliation. No live read was executed by this task; GET is not represented as proof of zero backend writes. LAB compared relevant pinned/local source files, not the running server's authenticated contract.

## UI and partial-data behavior

- One compact row: Project, Profile and 44px refresh icon. Type/Bot dropdown removed; canonical Bot Chats, ordinary profile history, Groups and Bots navigation remain.
- One quiet history status with Retry and collapsed Read details, grouping identical failures by operation/class/status across profiles. A cold failure is not a successful empty list. Details expose sanitized route identity and HTTP status when available; they omit origins, queries, dynamic session IDs, raw exception/server bodies and mutation-oriented “No state changed” copy.
- An in-memory cache is owned by the `ChatSource` connection instance. Partial profile/tree/page failures preserve verified rows in Recent with explicit incomplete/last-verified wording, rather than silently dropping history or claiming stale project membership. Hydrated older rows survive failures too. Successful refresh replaces old rows; a successful empty response retires them; removed roster owners are forgotten. Late responses cannot overwrite newer cached evidence.
- Roster failure keeps the existing verified snapshot/hydration, suppresses further hydration attempts and disables deletion. Failed or removed project options reset to All projects instead of displaying that option while invisibly retaining a stale filter; available filters are preserved.
- Pins remain local display order only. No session/project move, membership change, cwd/profile change, backend/auth setting, dependency installation, or publication is part of this candidate.

## Verification and evidence

Repeatable commands live in `app/package.json`. The native built-App gate is included in the existing CI workflow and its artifact upload, without browser downloads or a new pipeline. Authoritative candidate receipt: `evidence/chats-read-filters.json` (created after final gates).

- New built-App native-read suite: all four widths 320/360/390/430, filter interactions, canonical protection, 44px geometry, global/partial failure, Retry/details, safe 401/503/non-JSON/network classification, roster failure and filtered refresh. Native HTTP is intercepted, never replaced by a JS fetch mock.
- Extended source tests retain the original identity/delete/pagination assertions and add partial cache/hydration, empty/removed-owner retirement, late responses, exact-deletion eviction, later-page preservation and sanitized diagnostics.
- Existing feature suite keeps 17 checks and review suite keeps 6. The former Bot filter check now proves the two-filter contract, canonical-only identification, duplicate protection, misleading ordinary title and correct-profile navigation; unrelated assertions were retained.
- Required coupling gates: unit, lint, typecheck/build; 62 layout checks; 15 production journeys; 26 harness self-tests; navigation, live reveal, management browser; static publisher's 31 temporary-tree tests. Lint retains the same seven baseline warnings, not a warning-free claim.
- Visual review caught an initial inline Retry inheriting global `width:100%`; a red geometry assertion now checks text/target non-overlap and bounded status height at every width. The scoped `width:auto` correction is present in final screenshots.

Temporary receipts and logs use `/tmp/hm-chats-read-*`; final screenshots include `green/chats-{width}.png`, `green/read-failure-{width}.png`, and `green/read-details-{width}.png` under that prefix. Intermediate failed receipts are investigation evidence, not final release results.

## Remaining evidence and release gate

No credentials, local Hermes configuration, cookies/tokens, live auth/backend operations, commits, pushes or publication were performed. Build output exists only in the exclusive worktree; canonical node_modules is symlinked, canonical dist untouched. Root AGENTS.md/MAP.md/CONTEXT.md are absent in this repository; README, product/design and existing contract docs provided the project boundaries.

Parent owns independent frozen-source review and any source delivery. Static publication needs its separate gate and the existing guarded release pipeline. For exact phone attribution/acceptance after authorization, minimum evidence is served bundle identity, browser family/version, whether the original request dispatched and sanitized exception, then actual chosen-profile rendering on the existing connection. If another failure remains, collect only route template, numeric status/browser error, response media type, and same-origin relationship—not HAR secrets or response contents. Authenticated runtime compatibility, actual user history recovery and physical-phone acceptance remain unverified here.
