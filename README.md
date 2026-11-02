# Home Server Dashboard

A responsive home-server dashboard with system stats, private file storage, and a scrollable short-video feed. The UI shares a background-adaptive theme across desktop, tablet, and phone layouts.

## Run the app

Requirements: Node.js 18.15 or newer.

```sh
npm start
```

Open <http://localhost:3000>. The server creates `data/files/` for stored files and serves both the web pages and their APIs. To use another port, set `PORT` before starting:

```sh
PORT=8080 npm start
```

The server listens on all network interfaces by default. Keep it on a trusted network and apply appropriate firewall rules before exposing it beyond your LAN.

A static-only preview is also possible:

```sh
python3 -m http.server 8765 --directory public
```

Then open <http://localhost:8765>. This only serves the UI and images; dashboard stats, file management, uploads, likes, and comments require the Node server.

## Pages

- `/` — CPU, memory, storage, uptime, host details, and the current local daypart and clock.
- `/storage.html` — file and folder browsing, uploads, sorting, previews, and text/code editing.
- `/shorts.html` — vertically scrolling video feed with upload, playback, likes, and comments.
- `/repos.html` — local Git repositories with a code editor, changes, commits, branches, remote push, README preview, and releases.
- `/minecraft.html` — one managed Minecraft server with Java setup, file manager, lifecycle controls, and a separate Minecraft console.
- `/terminal.html` — built-in operational checks for the host and managed services.

## Daypart backgrounds

Place these images in `public/assets/`:

- `morning.png` — 05:00–10:59
- `day.png` — 11:00–16:59
- `evening.png` — 17:00–20:59
- `night.png` — 21:00–04:59

The page checks local time periodically, switches to the matching image, and samples its colors to adapt the interface palette. If a daypart image is missing or fails to load, it falls back to `Mountain.jpg`.

## Storage and API

User files are kept under `data/files/`; Shorts videos are stored in `data/files/Shorts/`. Likes and comments are kept in `data/shorts.json`. Git repositories are stored in `data/repos/`. The managed Minecraft server and Temurin Java runtimes are stored in `data/minecraft/server/` and `data/minecraft/runtimes/`. These data directories are created as needed and are not served as public static files.

The Minecraft manager supports one server, uploaded JARs or a browser-selected server folder, explicit EULA acceptance, and Java 8–25. Automatic Temurin installation currently supports Linux x64 and arm64 hosts and verifies downloaded runtime checksums. The Minecraft console is connected only to that server process. The separate Operations Terminal runs built-in diagnostics and a configurable allowlist of host commands, without implicitly invoking a shell or `sudo`.

Edit the `terminalAllowedCommands` array near the top of `public/js/terminal.js` to configure the terminal allowlist. Reload `/terminal.html` after changing it; the page sends the list to the running server. The server validates and keeps the submitted list in memory. Allowed executables run with the Node server's permissions, so add only commands you trust. Arguments are passed directly, with shell operators and expansions disabled.

For temporary testing, start with `TEST_MODE=true npm start` to bypass the executable allowlist. This allows arbitrary executables to run with the server's permissions. The server prints a warning at startup; only use test mode on a trusted, isolated machine and turn it off afterward.

The first-party `/storage.html`, `/shorts.html`, `/repos.html`, and `/minecraft.html` pages can use their same-origin APIs without entering a token. Other API clients must send `Authorization: Bearer <token>`. By default, the server generates and prints a token at startup; set `FILES_API_TOKEN` to choose a stable token. For a browser app on another origin, set `CORS_ORIGIN` to that exact origin.

See [API.md](API.md) for file, Shorts, Repos, Minecraft, and Operations Terminal API routes, payload formats, limits, and examples.

## Project layout

```text
.
|-- server.js
|-- package.json
|-- API.md
|-- data/                 Created at runtime for content, repositories, and Minecraft
`-- public/
    |-- assets/           Backgrounds and icons
    |-- css/              Shared and page-specific styles
    |-- js/               Dashboard, Storage, Shorts, Repos, Minecraft, Terminal, and theme logic
    |-- index.html
    |-- storage.html
    |-- repos.html
    |-- minecraft.html
    |-- terminal.html
    `-- shorts.html
```
