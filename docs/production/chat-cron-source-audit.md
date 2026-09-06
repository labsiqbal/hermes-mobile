# HM-UX-04 — LAB source-contract audit (draft for parent/builder)

## Verdict

**Pinned upstream accepts `profile` on `session.delete`; exact RPC success result is `{ "deleted": "<exact supplied session_id>" }`. Adding the argument alone is NOT a fail-closed cross-profile deletion guarantee.** The shared RPC profile resolver falls back to the launch store for nonexistent/unresolvable profiles. Keep that destructive safety gate explicit.

Source pin: official `NousResearch/hermes-agent` commit **`9dd6634c5635321cf38840cc30e9b51226689128`** (validated as a literal 40-hex identifier; public raw files fetched at that exact pin). Local HEAD observed: `de9c5d1b7272fb6ab3204370357d955dad9dbd06`; local line references describe the working files read, not a claim that they match HEAD.

Scope performed: scout/read-only source audit. Read workspace INDEX, workflow/project-types/memory-layer standards, LAB SOUL, Hermes skill plus profile/background references, production contracts, and relevant client code. No local Hermes configuration, secrets, state DB, runtime requests, code execution from upstream, repository writes, or mutation requests. Only this `/tmp` report was written. Source code was inspected in memory. Public docs extraction failed with a tool network-address classification; pinned official `website/docs/user-guide/bot-mode.md` was used instead. One guessed split-module path returned 404; complete public Git tree discovery located the real handlers. No repeated failing-source loop; retry cap respected.

All upstream references below are relative to this [pinned tree](https://github.com/NousResearch/hermes-agent/tree/9dd6634c5635321cf38840cc30e9b51226689128).

## 0. Focused follow-up: literal `default` when launch/current differs

Independently traced the complete pinned resolver, rather than assuming default is an omitted parameter:

1. `hermes_cli/profiles.py:229–234`: `get_profile_dir("default")` returns `_get_default_hermes_home()`, not the current named profile.
2. `profiles.py:129–139` → [hermes_constants.py:146–162](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_constants.py#L146): normal named homes resolve back to the installation root; custom `<root>/profiles/<name>` resolves to `<root>` too.
3. `server.py:457–469`: with a named launch home and an existing different default root, `_profile_home("default")` returns that root; omitted profile returns `None` and stays on the named launch home.
4. Hence **`{profile:"default"}` and `{}` are NOT equivalent** for `session.list`, `session.delete`, or project tree/drill-in when current process is named. REST explicit `?profile=default` likewise selects the installation root via `web_server_cron.py:112–123` and `web_server_sessions.py:180–193`.
5. A missing/empty row owner, `canonical_session:null`, empty sessions/tree, or a `default` fallback in client code is **not evidence of default ownership**. RPC ordinary listing has no owner echo at this pin. Tree session echoes report `_response_profile_name`, but zero-session project nodes have no owner echo. Preserve unknown as unknown.

**Finite HM-UX-04 recommendation (no backend expansion):** extend existing list/delete/tree wrappers to serialize an explicitly supplied validated literal profile, including `default`; preserve gateway+profile provenance from authoritative owner-echo reads/roster identity; reuse the existing scoped cron adapter. Never use `row.profile ?? "default"`. For deletion where exact ownership/compatibility cannot be established, show unavailable rather than guessing, switching transport, or changing backend. Tests should compare named-process requests with omitted versus literal-default scope and reject empty/missing owners. The acknowledged RPC resolver race remains a documented unsupported guarantee, not a request to build a new backend in this ticket.

Builder's `/tmp/hm-ux04-sources` files were discovered after steering; already-loaded independent source bodies were reused rather than downloaded again. Only the previously unread `profiles.py` and `hermes_constants.py` were fetched for this focused resolver verification.

## 1. Session list: exact scope and transport

### Existing JSON-RPC wrapper

`app/src/lib/hermes-client.ts:1000–1006` only serializes `limit`/`title`; it currently cannot select profile. The shared authenticated WS transport at `816–833` serializes `{jsonrpc:"2.0",id,method,params}`.

Supported upstream request:

```json
{"jsonrpc":"2.0","id":1,"method":"session.list","params":{"profile":"<literal existing profile>","limit":200,"include_hidden":false}}
```

Result: `{sessions:[{id,title,preview,started_at,message_count,source}]}`. Ordinary list rows **do not echo profile, cwd, or project metadata**. It is a bounded recent human-facing list, not an exhaustive profile inventory: `tool`/`kanban` sources are excluded, hidden rows default off, and there is no offset parameter in this handler. The exact-title branch returns at most one row and additionally `resolved_id`; it is not limited by the recency window.

Evidence: [methods_session.py:124–144](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/tui_gateway/methods_session.py#L124), `363–402`; `_with_db` at `36–44` → [server.py:420–469](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/tui_gateway/server.py#L420).

**Resolver warning:** omitted profile means launch profile, not necessarily `default`. `_profile_home` returns `None` on lookup failure or missing directory; `_profile_db` then uses the launch handle. Thus a misspelled/deleted profile can silently select another store. Do not stamp requested profile onto unowned RPC rows and present that as server-verified ownership. Validate literal roster membership and compatibility; these checks reduce risk but cannot eliminate a profile-deletion race.

### Stronger owner-echo listing option

Pinned REST provides:

```text
GET /api/sessions?profile=<encoded literal>&limit=100&offset=0&order=recent&archived=exclude&full=false
```

Optional `source`, `sources`, `exclude_sources`, `cwd_prefix`, `min_messages`; `limit` maximum 100. Exact result `{sessions,total,limit,offset}`; every row is stamped with `profile` and `is_default_profile`. Require returned owner to equal the selected literal. Concrete profile resolution validates name/existence and returns 400/404 rather than RPC's missing-profile fallback. Preserve explicit `profile=default` even on a named-profile gateway. This remains a visibility-filtered session browser (not every hidden/child database row).

Evidence: [web_routers/sessions.py:165–222](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_cli/web_routers/sessions.py#L165), `web_server_sessions.py:180–193`, `web_server_cron.py:112–123`.

**Read side effect:** REST listing calls config-gated auto-archive maintenance (`sessions.py:184–186`; `web_server_sessions.py:203–223`). GET is not a proof of zero backend writes. No such request was made during this audit. Reuse existing cookie-auth transport conventions, not new credentials/login.

## 2. Deletion: exact contract and unsupported guarantees

Existing `hermes-client.ts:1132–1149` omits profile and types `deleted` optional. Supported RPC:

```json
{"jsonrpc":"2.0","id":2,"method":"session.delete","params":{"session_id":"<full stored row id>","profile":"<literal existing profile>"}}
```

Exact success envelope: `{jsonrpc:"2.0",id:2,result:{deleted:"<same supplied id>"}}` (wrapper returns the result object). Require `deleted === confirmedStoredId`, not mere truthiness.

[methods_session.py:898–917](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/tui_gateway/methods_session.py#L898):

- 4006: missing/empty `session_id`.
- 4023: stored ID matches a live session's `session_key` in this gateway process. No automatic close/interrupt workaround.
- 4007: target not found.
- 5036: cannot snapshot live sessions, database unavailable, or deletion exception.
- Uses the selected profile DB and `home / "sessions"` for transcript cleanup, subject to the resolver fallback above.
- Input is the **full stored ID**, not a live runtime ID, prefix, title, or client-selected replacement. No implicit compression-tip resolution occurs in delete. Preserve the particular row the user confirmed; canonical `id` and `resolved_id` can differ.

[hermes_state_sessions.py:1416–1473](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_state_sessions.py#L1416): deletes target/messages and recursively delegated children; branch/compression children are orphaned, not deleted. File unlink errors are swallowed. Therefore `{deleted:id}` proves the DB deletion branch succeeded, **not complete disk erasure or deletion of a whole conversation lineage**. RPC does not expose the core `expected_delete_ids` precondition. Its live guard is process-local, target-only, and not atomic with deletion; it is not a cross-process/cascade liveness guarantee.

REST is a DIFFERENT contract, not a transparent fallback: `DELETE /api/sessions/{full-id}?profile=<literal>` → `{ok:true}` or `{ok:true,already_absent:true}`; it validates concrete profile but resolves ID prefixes, has no equivalent active-session guard, and calls `delete_session(sid)` without `sessions_dir`. Evidence: `web_routers/sessions.py:564–576`. **Do not silently switch to REST on RPC refusal.**

Builder gate: scope confirmation to immutable gateway identity + URL + profile + exact stored ID; cancel on selection/disconnection/context changes, consume once, no automatic retry. Recheck known profile and exact-target ownership before dispatch; acknowledge that preflight is not atomic. Unknown/malformed acknowledgments or transport loss after dispatch mean outcome unknown. Verify absence with an exact-target read, not absence from a bounded list. Pinned `GET /api/sessions/{id}?profile=...` at `476–489` can return exact row/owner or 404, but includes full row data: project narrowly and never log raw response. A generic/proxy 404 is not proof of deletion without established route compatibility.

**Unsupported release gate:** if HM-UX-04 requires guaranteed fail-closed cross-profile deletion under stale/missing profiles and concurrent changes, this pin does not supply that guarantee. Leave destructive cross-profile UI disabled until an approved strict backend contract/version exists; do not claim that an added optional argument fixes it. Canonical Bot Chat deletion should remain unavailable unless explicitly approved as a separate forever-chat destruction policy.

## 3. Bot filter is not the Profile filter

Official [bot-mode.md:8–26](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/website/docs/user-guide/bot-mode.md#L8): a Bot is a profile; the roster has one row per profile; its canonical Bot Chat is a specific forever-conversation, while regular sessions on that profile remain distinct.

- `profiles.list {include_sessions:true}` gives `canonical_session`, `last_session`, and `worker_session` separately. Use canonical identity for **Bot Chat**; `last_session` is not the canonical target and worker activity is not another canonical chat.
- Canonical identity is `(gateway, profile, exact title "Bot Chat")`; canonical response supplies registry `id`, compression-tip `resolved_id`, and `root_title`. Resume the returned tip in the same profile; do not rewrite stored context or project membership.
- `ui_meta['hermes-bots']` is Bot-Mode-managed metadata, not proof that every session in that profile is a canonical Bot Chat. Do not require that metadata to recognize every roster profile, nor classify by handle/avatar/title substring.
- Exact lookup: `session.list {profile,title:"Bot Chat",include_hidden:true,limit:5}` (existing `sessionFindBotChat`, client `1197–1205`). Treat failures as unknown, never “absent, create replacement.” `profiles.list` canonical helpers swallow failures into null, so null alone does not prove absence.

Evidence: [methods_profiles.py:138–170](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/tui_gateway/methods_profiles.py#L138), `175–254`; `tools/bot_mode_probe.py:86–94`; Desktop `plugins/hermes-bots/canonical-chat.ts:20–28,184–216`.

**Side effect:** both canonical lookup paths can unarchive accidentally reaped canonical rows (`methods_session.py:367–379`, `methods_profiles.py:113–160`). Filter requests are not a strict zero-backend-write contract. Pinned comments disagree about DB title uniqueness; the audited exact-title SQL (`hermes_state_titles.py:149–155`) has no ordering. Trust server-resolved canonical identity, not a client-side uniqueness assumption. Existing room creation also uses `"Bot Chat"` (`hermes-client.ts:1224–1238`); title alone must not merge room rows and canonical references.

Recommended labels: **Profile = ordinary visible sessions owned by selected profile; Bot = canonical Bot Chat(s) of selected roster bot(s)**. If product instead means “all chats with this bot/profile,” label it explicitly; upstream has no separate per-session bot-membership filter proven here. Never create/adopt/rename/unhide chats merely to populate filters.

## 4. Projects and multiple display-only pins

Both upstream methods accept explicit `profile`:

```text
projects.tree {profile,preview_limit:3,session_limit:2000}
  -> {projects,active_id,scoped_session_ids}
projects.project_sessions {profile,project_id,session_limit:5000}
  -> {project:<hydrated project or null>}
```

Evidence: [methods_config.py:77–113](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/tui_gateway/methods_config.py#L77); profile wrapper `15–23` → `server.py:477–505`; `project_tree.py:35–42` stamps session owner in preview/hydrated rows. Existing local `projectTree`/`projectSessions` (`hermes-client.ts:1008–1020`) omit profile. Pinned tests `tests/tui_gateway/test_projects_rpc.py:775–831` explicitly assert profile-isolated tree and drill-in; tests were read, not executed.

Tree uses selected profile `projects.db` AND `state.db`; it is not a global filesystem tree or all-profile inventory. Counts and memberships are limited to the fetched window: minimum one message, excludes cron/kanban and hidden/child visibility, overview/drill-in limits differ. DB unavailability can return empty tree/null rather than an error. Evidence: `methods_projects.py:313–361`, `methods_config.py:90–113`.

Display pins should be a client presentation set keyed by `(gateway,profile,project_id)`. Fetch/hydrate only those returned project IDs in that same profile. Do NOT implement multiple pins by calling `projects.set_active`, moving sessions, setting cwd/profile, adding folders, or changing context. `active_id` is the server's single active-project pointer, not a multi-pin store. The tree overview reconciles discovery-cache policy (`methods_projects.py:350–360`), so even this read method is not a guaranteed zero-write backend operation. No scan/record RPC is needed.

**Unsupported gates:** stale/unknown profiles share RPC fallback risk; session owner echoes must match, but empty/zero-session projects offer no independent owner echo. Do not present bounded or unavailable tree results as exhaustive. Retain immutable scope keys and reject late responses after scope changes.

## 5. Cronjobs list: already has a scoped adapter

Exact transport: **`GET /api/cron/jobs?profile=<encoded literal existing profile>`**. Result is a **bare array**, not `{jobs:[...]}`. It includes disabled jobs (`list_jobs(True)`). Each job is annotated with `profile`, `profile_name`, `hermes_home`, `is_default_profile`. Omitted parameter defaults to **`all`**, aggregating profiles and swallowing per-profile errors; never omit it for a scoped UI.

Evidence: [web_routers/cron.py:83–97](https://github.com/NousResearch/hermes-agent/blob/9dd6634c5635321cf38840cc30e9b51226689128/hermes_cli/web_routers/cron.py#L83), `211–213`; `web_server_cron.py:112–165`; `cron/jobs.py:1834–1847`.

Reuse `ManagementClient.schedules(profile,signal)` (`app/src/lib/management-client.ts:193–225`): explicit query, rejects owner mismatch, projects only `id,profile,name,state,enabled,schedule_display,next_run_at,last_run_at`. Existing `docs/production/management-contracts.md:40,46–55` already documents this scope/transport. Do not fetch routine prompts/scripts/delivery details to render a list. Preserve server timestamps and cadence strings; no invented next-run calculation. No all/current/custom aliases, execution, pause/resume/edit/delete, or background scheduler claim.

## Parent handoff gates

1. Serialization-only changes can be built/tested against these exact contracts; **source compatibility is not deployed-runtime verification**.
2. Keep strict cross-profile deletion blocked unless the documented RPC fallback/race is resolved by an approved backend contract or the product explicitly accepts a narrower safety model.
3. Do not drop literal `default`: existing `sessionMessages` at client `1054` currently omits it, which can misroute default-profile history on a named launch gateway. Relevant adjacent bug; not changed by this audit.
4. No moving sessions/projects/context. Multi-pins and filters are presentation only. No fallback creates, auto-closes, hidden-state writes, profile switching, or cron mutations.
5. Read APIs can perform maintenance/recovery internally; do not call them a strict no-write runtime guarantee. All runtime and device verification remains unperformed here by instruction.
