# Map - hermes-mobile

## Purpose

Delivered mobile PWA and optional relay for a self-hosted Hermes gateway. PR #27 merged on 2026-09-18. Remaining Orca/Treehouse checkouts are historical task artifacts and must be closed through their harness after checking local evidence.

## Routing

| Need | Read |
|---|---|
| Same-origin Tailscale serve | [deploy/serve.sh](deploy/serve.sh) |
| Isolated static publisher | [deploy/publish-static.py](deploy/publish-static.py) |
| Project rules | [AGENTS](AGENTS.md) |
| PWA | [Application](app/) |
| Development, build, and test scripts | [app/package.json](app/package.json) |
| CI checks and supported Node version | [Quality gate](.github/workflows/check.yml) |

## References

| Need | Read |
|---|---|
| What it is, install, add a device, tabs | [README](README.md) |
| Optional headless bot relay and configuration | [Relay README](relay-daemon/README.md) |

Repository: [labsiqbal/hermes-mobile](https://github.com/labsiqbal/hermes-mobile).
The upstream gateway is maintained in
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).

Deployment is optional for contributor checks. For a self-hosted installation,
follow the setup instructions in the linked deployment scripts and supply your
own gateway configuration. Keep installation-specific credentials and runtime
data outside the repository.
