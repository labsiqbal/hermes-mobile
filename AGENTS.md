# Hermes Mobile

This repository owns the mobile PWA and optional relay, not the upstream
[Hermes Agent gateway](https://github.com/NousResearch/hermes-agent).
Read [README.md](README.md) for installation and adding a device;
[MAP.md](MAP.md) for source, checks, and deployment entry points.

Live gateway tests need explicit operator authorization: they can create
sessions, trigger agent actions, and incur provider costs. Use fictional
fixtures for offline checks. Keep credentials and private runtime data out of
commits and screenshots; preserve existing runtime and credentials during
documentation work.

Public README screenshots must match the current built app. Recapture with
fictional fixtures rather than copying images from PRs; see the current tabs
in [README.md](README.md).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
