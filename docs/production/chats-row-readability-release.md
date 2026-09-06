# HM-UX-08 live release

**Published and anonymously verified on 2026-09-06** at <https://nuc.tailcf7779.ts.net:8451/>. Owner approved live publication. This receipt resumes the previously blocked release; historical evidence remains unchanged.

## Source and approved guards

[Source PR #9](https://github.com/labsiqbal/hermes-mobile/pull/9) merged reviewed head `07ce2c9f72a5a4a475a0862522b36e86a3cfc433` as `4e736b9676bb168aba46df0ab26fd2b78163d447`. [PR CI](https://github.com/labsiqbal/hermes-mobile/actions/runs/34017097879) and [main CI](https://github.com/labsiqbal/hermes-mobile/actions/runs/34017317439) passed before publication and were read back during resume. [Source delivery](evidence/chats-row-readability-source-delivery.json) records exact identities. Resume reverified main, frozen inputs and all 12 artifact files, reusing the prior successful isolated build/test evidence rather than repeating it.

The [original dry-run](evidence/chats-row-readability-blocked-dry-run.json) refused route drift before any write. Parent independently verified that removing only `TCP/8457` and `Web/nuc.tailcf7779.ts.net:8457` **in memory** reproduced the historical full-route digest exactly; all previous routes, including :8451, were identical. Parent expressly approved the refreshed guard. The executor independently repeated that read-only comparison and recorded [separate acceptance evidence](evidence/chats-row-readability-route-guard-acceptance.json). Neither routes nor old receipts were changed.

| Identity | SHA-256 |
|---|---|
| Frozen manifest | `4ad73d4128aae58217e6aa5a7ef7a4aa0c7bf47194a97e80f18a41085d9b8ca9` |
| Prior entry | `4cdfb4b705c173e12ab07a703af937140a113c3bd7b5826685facc2e2417434d` |
| Published entry | `6f91f1f0c7f7f9cfa7fc207806d1ee78d2ffdc68f1664fe3f4406ae57ac1598f` |
| Historical route | `5759f3513fa7dd18a01d1eefc840816737f9089387fbc30ea06b166c3aa6a1a5` |
| Explicitly approved refreshed route | `b8f93e33860152933c5314075d09f5995437755d59b621f7a258a64d141450c6` |

## Publication and verification

Existing `deploy/publish-static.py` passed the [resumed dry-run](evidence/chats-row-readability-dry-run.json). Its [acceptance](evidence/chats-row-readability-dry-run-acceptance.json) pins the exact arguments; publication appended only `--publish`. The [publisher receipt](evidence/chats-row-readability-publication.json) returned **published / complete**, no error: six immutable assets added, entry switched last, all 38 prior non-entry files retained. Only `/home/iqbal/workspace/personal/hermes-mobile/app/dist` was published.

- [Approved manifest](evidence/chats-row-readability-artifact-manifest.json): 12 files from `/tmp/hmux08-release-xgk7hczc/source/app/dist`.
- [Independent HTTPS readback](evidence/chats-row-readability-served-verification.json): all 45 live files matched disk/manifest hashes through 90 anonymous GETs, plain and cache-busted; full route guard unchanged.
- [Fresh Chrome boot](evidence/chats-row-readability-browser-verification.json): real HTTPS `/#home` at 390×844, no fixture, credentials, cookies, storage, API calls or WebSockets. Loaded entry/JS/CSS/support hashes matched, diagnostics were empty, and the disposable browser/profile was cleaned up.
- [Visually reviewed entry](evidence/chats-row-readability-served-entry.png): complete connection registry, zero devices, empty form and credential warning; no loading/error overlay.

## Durable finalization and limits

[Release JSON](evidence/chats-row-readability-release.json) indexes checksummed receipts. Originals remain in `/tmp/hmux08-release-xgk7hczc/`. Receipt-only branch: `docs/hmux08-release-receipt`. Its final head/merge, PR/main CI results and canonical preservation proof are recorded after merge in `/tmp/hmux08-release-xgk7hczc/final-state.json` and a byte-verified comment on the receipt PR, avoiding recursive receipt commits or republication.

The known six untracked `.hermes/` and `design/reviews/` files and old receipts were preserved. No canonical build, service/restart, routes, auth/backend configuration, secrets, dependencies, live prompt/session actions, rollback or asset pruning occurred. Existing `manifest.webmanifest` MIME remains `text/plain`. Anonymous boot is not authenticated gateway or physical-phone acceptance. Parent independent external readback remains separate and is not claimed by this executor.
