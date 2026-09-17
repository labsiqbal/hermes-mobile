# Hermes Mobile Map

| Need | Open |
|---|---|
| What it is, install, add a device, tabs | [README](README.md) |
| Same-origin Tailscale serve | [deploy/serve.sh](deploy/serve.sh) |
| Isolated static publisher | [deploy/publish-static.py](deploy/publish-static.py) |
| Optional headless bot relay and configuration | [Relay README](relay-daemon/README.md) |
| Project rules | [AGENTS](AGENTS.md) |
| PWA | [Application](app/) |
| Development, build, and test scripts | [app/package.json](app/package.json) |
| CI checks and supported Node version | [Quality gate](.github/workflows/check.yml) |

Repository: [labsiqbal/hermes-mobile](https://github.com/labsiqbal/hermes-mobile).
The upstream gateway is maintained in
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent).

Deployment is optional for contributor checks. For a self-hosted installation,
follow the setup instructions in the linked deployment scripts and supply your
own gateway configuration. Keep installation-specific credentials and runtime
data outside the repository.
