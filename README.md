# CFPanel

CFPanel is a lightweight Electron desktop app by **NekoSuneProjects** for managing common Cloudflare tasks without repeatedly signing in to the Cloudflare dashboard.

## Features

- Dashboard with domain and Cloudflare Tunnel status
- List, add and remove Cloudflare zones
- DNS record manager with create, edit and delete actions
- Create and delete remotely-managed Cloudflare Tunnels
- Publish a domain/subdomain through a tunnel
- Automatically create the required proxied `CNAME` to `<tunnel-id>.cfargotunnel.com`
- Retrieve a tunnel connector token and copy Windows, Linux or Docker install commands
- Cloudflare API token is encrypted locally with Electron `safeStorage`
- GitHub Actions builds Windows and Linux packages
- Tagging `v*` publishes installers to a GitHub Release

## Authentication

CFPanel uses a scoped **Cloudflare API Token** instead of your Cloudflare dashboard password or Global API Key.

Recommended permissions for the features currently implemented:

- Zone → Zone → Read
- Zone → DNS → Write
- Account → Cloudflare Tunnel → Read
- Account → Cloudflare Tunnel → Write

Scope the token to only the Cloudflare account/zones you want CFPanel to manage.

You will also need your Cloudflare **Account ID**. Enter the Account ID and API token once in **Settings**. The token is encrypted by the OS through Electron `safeStorage`; CFPanel refuses to save it if secure OS encryption is unavailable.

> Never commit API tokens, Global API Keys or tunnel tokens to this repository.

## Run locally

```bash
npm install
npm start
```

## Build

```bash
npm ci
npm run dist:win
# or
npm run dist:linux
```

Build output is placed in `dist/`.

## Release

Create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds Windows (`.exe`) and Linux (`.AppImage`, `.deb`) packages and attaches them to the GitHub Release.

## Tunnel workflow

1. Open **Zero Trust Tunnels**.
2. Create a tunnel.
3. Open **Connector token** and install `cloudflared` on the server.
4. Select **Add hostname**.
5. Choose a Cloudflare zone, enter the full hostname (for example `app.example.com`) and local service URL (for example `http://localhost:8080`).
6. CFPanel updates the remote ingress configuration and creates/updates the proxied tunnel CNAME automatically.

## Security design

- Renderer has no Node.js integration.
- `contextIsolation` and Electron sandboxing are enabled.
- The Cloudflare token is only decrypted in the Electron main process.
- Cloudflare API calls are performed in the main process.
- External navigation is blocked from the app window.
- A restrictive Content Security Policy is applied to the renderer.

## Current scope

CFPanel currently focuses on **Zones, DNS and Cloudflare Tunnel management**. It does not try to replace every Cloudflare dashboard product.

## License

MIT
