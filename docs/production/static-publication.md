# Static publication gate — HM-PROD-01

`deploy/publish-static.py` publishes only an already built, approved static artifact.
It defaults to **dry-run**. Source commits, builds, browser review and artifact
approval are separate gates; running this tool does not establish them.

## Fixed boundary

- Production: **https://nuc.tailcf7779.ts.net:8451** (private Tailnet HTTPS).
- Existing serving directory: `/home/iqbal/workspace/personal/hermes-mobile/app/dist`.
- CLI has no alternate root/origin, route mutation or service controls. Linux,
  Python 3.9+ stdlib, an already usable `tailscale` CLI and HTTPS trust are required.
- Build in an isolated worktree/output directory. Keep the approved artifact and
  its frozen manifest outside the live root, separate from one another.
- Keep all old files except the entry HTML. Changed stable support URLs, including
  `logo.png` and `manifest.webmanifest`, are refused. New files are limited to flat
  `assets/<name>-<hash>.<extension>` names with an eight-character-or-longer Vite
  hash token. Their parent directory must already exist. Filename syntax is not
  proof of Vite's hash algorithm: reviewed build provenance plus SHA-256 of the
  actual bytes is the approval boundary. New stable worker/HTML/support URLs
  cannot be introduced through this tool; review must separately exclude new
  service-worker registration or other runtime behavior outside the static gate.
- Artifact paths must be normalized absolute paths. Relative manifest keys use
  safe ASCII components, without dot components, empty components, traversal,
  hidden files or URL escapes. Symlinks (including ancestors), hardlinked files
  and non-regular files are rejected in either tree and at the manifest file.

This deliberately refuses broader releases. If stable support bytes must change,
version them into approved hashed asset URLs and rebuild/review, or obtain a
separately scoped release mechanism. Never work around refusal by rebuilding in
canonical `app/dist`, deleting assets or invoking `deploy/serve.sh`.

## Freeze and invoke

1. Finish source tests, build, isolated browser tests and independent review.
   Record the source commit and approved artifact path in the release receipt.
   Review HTML/JS references and runtime contracts; this publisher verifies file
   coverage/bytes, not application correctness or dependency reference semantics.
2. Freeze a UTF-8 JSON object mapping **every artifact file** to its lowercase
   64-character SHA-256. Keys are relative POSIX paths, including `index.html`.
   No comments or duplicate keys. Store the manifest outside both trees, sort
   its keys for repeatability, and record SHA-256 of its exact bytes in the
   approval receipt. Do not regenerate it during publication to accept drift.
3. Obtain the expected currently live entry SHA-256 and the full Serve JSON
   digest from the independently reviewed preflight. Route canonicalization is
   exactly `json.dumps(route, sort_keys=True, separators=(",", ":")).encode()`
   followed by SHA-256. Keep route JSON private; only the digest belongs in the
   release receipt. The tool also requires the origin's `/` handler to be exactly
   `{"Path": "/home/iqbal/workspace/personal/hermes-mobile/app/dist"}`.
4. With an approved artifact available, run from the reviewed source checkout:

   ```bash
   python3 -B deploy/publish-static.py \
     --artifact "$APPROVED_ARTIFACT" \
     --manifest "$FROZEN_MANIFEST" \
     --manifest-sha256 "$APPROVED_MANIFEST_SHA256" \
     --expected-entry-sha256 96121582978238d85ec631ab2168db880043b930cd7030d51af51df4923d177b \
     --expected-route-sha256 5759f3513fa7dd18a01d1eefc840816737f9089387fbc30ea06b166c3aa6a1a5
   ```

   These old-entry/route guards are the prior read-only production preflight,
   **not permanent defaults**. Drift fails closed; investigate rather than
   substituting newly observed values to bypass the gate. Manifest digest must
   come from approval, not a fresh unreviewed calculation. Exit 0 with
   `status=dry_run` means read-only preflight passed, not that content was served.
5. Only the release owner, after accepting that exact dry-run and final gate,
   may append the exact flag **`--publish`** to the same arguments. Abbreviations
   such as `--pub` are rejected. Capture stdout as the JSON release receipt in
   a separate review/evidence location, never inside either static tree. Preserve
   the program exit status if piping its output.

## Ordered checks and writes

1. Validate manifest digest, exact file coverage/hashes, paths, source/target
   separation, old-entry guard and all collisions before contacting production.
   Acquire a nonblocking directory `flock` without creating a lock file.
2. Read `tailscale serve status --json` only; require the complete route digest
   and exact serving root. Read `/api/status`; require authenticated gateway
   health (`gateway_running=true`, `gateway_state=running`, `overall=ok`,
   `auth_required=true`). Snapshot version, state and authentication fields.
   Verify every old file over plain and cache-busted HTTPS. Map only the exact
   artifact key `index.html` to canonical `/` and `/?release=<entry-sha256>`;
   all other files retain their exact `/<relative-path>` URLs and hash queries.
   Dry-run stops after rechecking routing/health, artifact and target snapshots,
   and performs no static writes.
3. Add missing hashed assets in sorted order. Write/fsync a complete sibling
   temporary file, atomically link it into place without clobbering any existing
   name, remove only that temporary name, and fsync the containing directory.
   Equal collisions are left alone; unequal collisions stop before any write.
4. Verify every added file's plain and cache-busted HTTPS bytes **before** entry
   switch. Recheck the frozen artifact, old-plus-added disk snapshot, root inode,
   routes, health and old served files. Stage the new HTML, fsync it, recheck disk
   and routes, then atomically replace `index.html` last and fsync the root.
   Its modification time advances beyond the old Last-Modified whole second.
5. Verify every candidate file and every retained old file, mapping `index.html`
   to canonical `/`, each plain and cache-busted. Require exact SHA-256 bytes, complete disk
   snapshot, unchanged root inode/routes and unchanged selected API health fields.
   Only then return `status=published`, `stage=complete`.

HTTP uses the fixed MagicDNS origin, no environment proxy, no credentials/cookie
jar, no redirects, identity encoding and `Cache-Control: no-cache`. Timeout or
non-200 response fails closed. No response bodies, exception text, raw route JSON,
backend addresses or argument values appear in the tool's JSON stdout.

The existing static server redirects the `/index.html` alias (observed `301`,
`Location: /./`). The publisher never requests or requires that alias; it checks
the old/new `index.html` SHA-256 against the canonical root response bytes instead.
This is exact entry-to-URL mapping, **not redirect tolerance**: a redirect at `/`,
its cache-busted form, or any asset/support URL still fails closed. Manifest keys,
on-disk entry guards, all old/new file hashes, route and authentication guards
remain unchanged. The invocation above needs no alias or redirect flag.

A read-only tooling dry-run may use an existing isolated **BASELINE** build with
an independently frozen, complete manifest and its recorded digest. Label that
receipt **tooling dry-run, not candidate approval**; do not rebuild in the live
tree or treat baseline success as approval of the production candidate. The
candidate still needs its own independent review, manifest and exact dry-run.

## Failure receipt and limits

The single JSON stdout object is the receipt; exit 1 means failure. `stage` is
where work stopped; `assets_added` is the number of successfully linked additions,
`planned_additions` is the full initial addition count, and `entry_replaced` says
whether the atomic entry replacement returned successfully. SHA-256 guard fields
identify the approved artifact/entry/route without printing their contents.
Before-entry failure leaves old HTML in place but may leave verified or unverified
new assets. After-switch failure leaves new HTML in place and **does not** imply
rollback. `temporary_cleanup_failed=true`, when present, means even deletion of
this invocation's staged temporary file failed. Stop and investigate; no automatic
retry, restoration, route repair, service restart or asset pruning is authorized.

The lock coordinates this publisher only. Arrange exclusive access: no other
builds, file writers, route editors or hostile filesystem actors during release.
Repeated drift checks are not a global filesystem/network transaction. SIGKILL,
power loss or process death can prevent a final receipt; inspect exact disk and
HTTPS state before further action. Never infer rollback from a missing receipt.
There is no saved old HTML, automatic retention expiry or cleanup operation.

API health checks cover unauthenticated routing only. They do not exercise login,
WebSockets, live prompts, `/v1` requests or saved credentials. Network byte checks
cannot prove browser/PWA refresh or physical-device behavior. Existing heuristic
caching and manifest MIME behavior remain unchanged; an open client may need a
normal reload. Preserve old lazy chunks indefinitely until separate cleanup
approval is supported by evidence.

## Isolated tests

```bash
python3 -B -m unittest discover -s deploy -p 'test*.py' -v
```

Tests call the publication seam with temporary roots and injected HTTPS/route
callbacks or an in-memory HTTP transport retaining urllib's real redirect/status
handling; they do not write to production or perform live network requests.
The suite covers dry-run immutability, manifest/hash/path/link rejection,
collisions/stable support, entry-last publication, old-file retention, both root
URL variants, redirecting index alias compatibility, wrong canonical-root bytes,
strict redirect rejection for roots/assets/support/alias URLs (plain and
cache-busted), route/API drift, sanitized receipts and pre/post-entry failure.
A passing suite is tooling evidence, not an approved candidate or live publication
receipt. Independent release review and the candidate-specific dry-run remain
required.
