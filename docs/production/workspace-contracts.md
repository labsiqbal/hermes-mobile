# Workspace production contract — HM-PROD-01

Status: implemented module + deterministic/browser-fixture verification; **not authenticated runtime parity or release approval**. Parent integration owns the Shell A route and final deployment gate.

## Integration and ownership

`app/src/screens/Workspace.tsx` default export accepts exactly:

```ts
{ conn: SavedConnection; client: HermesConnection; session: SessionSummary | null; onBack: () => void }
```

All three types are imported from `lib/hermes-client`. This module adds contextual Files / Git / Preview / Terminal switching, not another app shell. Parent owns header, Back history and conversation drafts. Returning calls `onBack`; it does not resume/create a session or change its cwd/profile. No App, theme, connection-client, dependencies, package scripts or lockfile changes.

Files in this lane:
- `app/src/screens/Workspace.tsx`
- `app/src/screens/workspace.css`
- `app/src/lib/workspace-client.ts`
- `app/scripts/check-workspace.mjs`
- `docs/production/workspace-contracts.md`

## Source pin and trace

Authoritative official source revision: `9dd6634c5635321cf38840cc30e9b51226689128`.
All source paths below are relative to [that pinned tree](https://github.com/NousResearch/hermes-agent/tree/9dd6634c5635321cf38840cc30e9b51226689128), read from public raw GitHub. Also read the current [official documentation index](https://hermes-agent.nousresearch.com/docs/llms.txt), the read-only parity source lock/inventory/native boundaries and approved A prototype in `parity-review`.

| Desktop facade | Actual backend | Decision |
|---|---|---|
| `apps/desktop/src/lib/desktop-fs.ts`: `readDesktopDir` | `hermes_cli/web_routers/files.py:607`, `fs_list`, `GET /api/fs/list?path=`; returns `entries[{name,path,isDirectory}]` | Traced, but not copied blindly: this route omits size and resolved-link metadata. |
| Same: `readDesktopFileText` | `files.py:630`, `fs_read_text`, `GET /api/fs/read-text?path=`; returns `{binary,byteSize,language,mimeType,path,text,truncated}` | Not used: it does not apply the managed-file sensitive-path guard. |
| Official managed Files API, same router | `files.py:357`, `list_managed_files`, `GET /api/files?path=`; `{path,entries[{name,path,is_directory,size,mtime,mime_type}],root,locked_root,can_change_path}` | Used for exact-directory browsing and canonical-path/size preflight. Absolute cwd is always supplied; server root/default is never substituted. |
| Official managed Files API | `files.py:406`, `read_managed_file`, `GET /api/files/read?path=` → `_managed_readable_file` at 380 → `_resolve_managed_path` → canonical sensitive-path guard → `{path,name,size,mime_type,data_url,...}` | Used for one explicitly selected UTF-8 text file. Decode bytes only; never navigate to or embed the returned data URL. |
| `apps/desktop/src/lib/desktop-git.ts`: `remoteGit.repoStatus` | `hermes_cli/web_routers/git.py:git_status_route` → `hermes_cli/web_git.py:198`, `repo_status`, `GET /api/git/status?path=` | Implemented only with explicit `git_repo_root === cwd`; canonical root checked through managed listing first. Return is `null` or `{branch,detached,changed,files:[{path,staged,unstaged,untracked,conflicted}],...}`. |
| Both facades: `fileDiff` / `desktopFileDiff` | `git.py:git_file_diff_route` → `web_git.py:302`, `file_diff_vs_head`, `GET /api/git/file-diff?path=&file=` | Implemented for one selected safe, existing, small text file; `file` is exact repository-relative path. No whole-tree diff, review fallback or arbitrary command. |
| Files facade: data-URL/download/reveal/rename/trash | `files.py:691` data URL, `701` download; local Electron methods for OS operations | Direct active-content download/preview not exposed. Reveal/rename/trash remain explicitly unavailable. |

`web_server_files.py:24` `_fs_path` resolves paths, but is **not** a sandbox or secret filter. The safer managed helper at `135` resolves canonical paths, applies a configured locked root, and rejects traversal. `_managed_file_entry` at `175` returns each resolved path; aliases whose returned path differs from the exact child path are excluded before any file content request.

Git backend detail matters: `file_diff_vs_head` tries `git diff HEAD -- <file>` then all-adds only genuinely untracked files. `review_diff` instead may all-add a clean tracked file, so it is deliberately not used. `repo_status` caps file rows to 200; null and empty diff can also mean Git failure. UI never labels either as definitive success/clean state. It suppresses aggregate counts, which may include protected/omitted files. The upstream status implementation does bounded server-side line counting for untracked files; the client never downloads those contents or uses a shell RPC.

## Routing and authentication

- `SavedConnection.id`, exact gateway URL, explicit `session.profile`, resolved-or-durable session ID, cwd and repository root form the immutable context key. Missing profile, missing cwd, filesystem `/`, mismatched live gateway, unsafe path or unavailable socket fails closed. No implicit `default` profile, home cwd, active-global connection, guessed root or profile backend.
- `SessionSummary` must come from the owning gateway. Parent must not pass a cwd copied from another host or a Desktop registry/SSH alias as a gateway-owned path. There is no browser equivalent of Electron's hidden connection registry resolution.
- Requests use the passed live client's URL and the **existing browser cookie session** established by `HermesConnection.login`: `credentials: include`. No password read/copy, extra login, bearer-token introspection, token query string or local IPC. Browser CORS remains authoritative. Bearer-only/native secure-storage transport is not implemented by this adapter.
- An explicit `profile` query is retained, consistent with Desktop `connection-config.ts:pathForRegistryBackendRequest` / `pathWithProfileScope`. **These filesystem/Git handlers operate on the addressed gateway's machine filesystem and do not independently authorize profile or session ownership.** The absolute path, live gateway and parent-provided session context are the addressing boundary; the query is not represented as a server-side profile sandbox. No unsupported `session_id` parameter is invented.
- Context changes remount the detail view. Tool changes, Back, disconnect and unmount abort pending reads; late responses cannot paint another context. No persistent file cache or localStorage is added.

## Security and limits

- No recursive traversal or root discovery. Each directory open issues one bounded metadata request; a file read revalidates only its immediate parent then reads only that selected file. A Git status request is user-selected and limited to the exact repository cwd.
- Client rejects traversal, percent-encoded paths, control characters, URL/file schemes, Windows/UNC paths, Git pathspec syntax, dotfiles, credential/auth/token/secret/key material names and common key extensions. The sole dot-directory exception is the exact `.worktrees` segment **as an ancestor**, supporting an explicitly supplied cwd such as `/home/iqbal/workspace/.worktrees/hermes-mobile/feature`. `.worktrees` itself remains unavailable as a listing target; `.git`, `.env`, `.ssh`, other dot ancestors and protected descendants remain blocked. This is lexical compatibility, not proof that a path is a Git worktree. Exact cwd containment, canonical listing/preflight and all existing Files/Git endpoints stay unchanged. Sensitive names, canonical aliases and generated folders never render. Protected-name paths never reach the content/diff transport.
- Readable text is extension-allowlisted, at most 128 KiB by preflight and response size; UTF-8 must decode without replacement. Binary/control content and likely private-key/token documents are not displayed. Redaction heuristics are defense in depth, **not an exhaustive secret detector**.
- Metadata/body cap: 1 MiB streamed response, 200 visible entries. Render cap: 128 Ki characters, 1,200 lines, 2,000 characters per line; truncation is explicit. No HTML/Markdown/SVG execution, image loads or injected markup.
- Requests are GET-only, no-store, JSON-only, redirect-error, no-referrer; 15-second timeout aborts fetch including body reads. Errors use safe local messages rather than gateway tracebacks. No automatic retries or writes.
- Preview is a manually supplied HTTPS navigation candidate only: no credentials (including empty userinfo), query/fragment (including empty delimiters), traversal, protected path, known loopback or exact app/gateway **origin**. The app origin and gateway context must be known; unknown session/profile/cwd remains unavailable. Different ports on the same hostname are eligible, not automatically trusted. The production app on port 8451 and preview on 8450 can therefore coexist without embedding active content.
- Every eligible preview requires **Review preview link → Trust and open preview**. The focusable confirmation names the exact destination and gateway, and explicitly warns: browser host cookies, including app/gateway authentication cookies, may accompany navigation even on a different port. `noopener,noreferrer` only protects the opener/referrer; it does **not** suppress cookies. The explicit final button calls `window.open(exactValidatedUrl, '_blank', 'noopener,noreferrer')` synchronously. No navigation-capable link exists before confirmation, and no app credentials are explicitly forwarded.
- Pending confirmation is one-shot and bound to the raw input, validated URL, app origin, immutable workspace context key and live gateway URL. Input changes (including changing back), Cancel/Escape, tool departure, disconnect, context change and unmount discard it; the final click rechecks the current live gateway and consumes confirmation before opening. No persistence, automatic probing/request, iframe, embedded artifact, provenance inference or annotation-parity claim.

### Remaining security/protocol gate

Canonical preflight is **not atomic** with a later file/Git read. The pinned backend does not expose an inode/version-bound, session-root-scoped no-follow read. It cannot guarantee containment against a concurrently hostile filesystem changing aliases/hardlinks between requests. The managed server guard blocks its known canonical credential filenames, but it is narrower than the mobile denylist. No frontend can prove arbitrary files never contain undisclosed secrets. **Do not claim adversarial-filesystem isolation or universal secret non-fetch guarantees from this lane.** Such a guarantee needs a separately approved upstream/backend contract; this lane is for the authenticated owner's trusted workspace. Backend authorization, deployment/version and physical-device verification remain release gates.

Preview trust is an informed navigation decision, **not an authentication-isolation guarantee**. A trusted destination can receive browser-managed cookies and can redirect after opening; this module neither inspects it nor verifies its operator. If a release instead requires zero authentication-cookie transfer, same-host port separation cannot satisfy that contract: use an independently approved cookie-isolated host/browser context or block navigation. No live preview was opened or requested in this correction.

Other honest limitations: unsupported APIs fail visibly without `/api/fs` fallback; locked-root denial stays denied; deleted files and files beyond visible list/size limits cannot be read/diffed; binary artifact viewing/export and an authoritative generated-artifact catalogue are not implemented. General terminal PTY, SSH/cloud lifecycle, OS operations and Electron browser annotation remain unavailable. `/api/pty` is Hermes TUI, not proof of a general shell equivalent. No live runtime writes or shell operations were executed.

## Verification

Run from `app/`:

```sh
node scripts/check-workspace.mjs
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/oxlint src/lib/workspace-client.ts src/screens/Workspace.tsx scripts/check-workspace.mjs
node scripts/check-chat-resume.mjs
node scripts/check-bots-utils.mjs
node node_modules/vite/bin/vite.js build --outDir /tmp/hermes-mobile-workspace-build
```

Verified after the preview/worktree correction: **20 deterministic request/scoping/security/error tests and 37 real-component Chrome DOM checks at each actual emulated viewport 360×844, 390×844 and 430×844**. Includes the existing text/diff rendering, directory bounds, protected-name exclusion, 44px buttons, overflow, offline/error, cancellation, stale-response rejection and Back callback; plus different-port candidate acceptance, no navigation before trust, exact open arguments, explicit cookie warning, changed/returned URL invalidation, Cancel, exact-origin refusal, unknown scope, gateway change at confirmation, and Files/Git under an explicit `.worktrees` cwd. Worktree unit coverage also denies protected descendants, sibling access and canonical-root mismatch. Every fetch is mocked; these are fixtures, not authenticated runtime evidence.

Harness uses existing esbuild/React and Chrome via CDP pipe with no debug port. A synthetic HTTPS app origin on `gateway.example:8451` is fulfilled entirely from local bundles through CDP request interception; all unexpected requests are blocked and fail the suite. `window.open` is a recording stub, so trust tests never actually navigate to previews. `--window-size` alone was caught rendering at 500px; final harness sets device metrics and asserts `innerWidth` exactly. Temporary bundles/Chrome profiles clean themselves up. `CHROME_BIN` may override the executable. Existing dependencies are symlinked from canonical app node_modules; no install or lockfile changes.

Typecheck, scoped lint (no diagnostics), whitespace checks on all five added files, and existing chat-resume/bots checks pass. Full `npm run lint` exits successfully but retains unrelated baseline warnings in `icons.tsx`, Bots, Rooms, Runs, ChatList, Groups and `scripts/smoke.mjs`; no full-repo lint-clean claim. Vite build to the isolated `/tmp` target passes (expected outside-root output warning); it validates the baseline application because parent has not imported Workspace in this lane. The browser test separately bundles and executes the **actual new Workspace module**. No canonical `app/dist`, publication, commit or push. Parent still owes independent standards/spec review, integration build/browser tests, authenticated safe read-only contract checks and real iOS/Android validation before release.
