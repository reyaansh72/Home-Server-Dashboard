# 🏠 Home Server Dashboard

Your home server, but make it ✨ fancy ✨

A responsive home-server dashboard packed with system stats, private file storage, a scrollable short-video feed, Git repository management, and even a Minecraft server manager.

Whether you're on a desktop, tablet, or phone, the interface adapts to your screen and shares a background-reactive theme. Pretty cool, right?

## 🚀 Getting Started

### Requirements
- Node.js 18.15 or newer

### Fire it up!

```sh
npm start
```

Now visit **http://localhost:3000** and welcome to your dashboard!

The server automatically creates `data/files/` for stored files and handles both the web pages and their APIs.

Want a different port? No problem:

```sh
PORT=8080 npm start
```

The server listens on all network interfaces by default. Keep it on a trusted network and configure appropriate firewall rules before exposing it beyond your LAN.

### 🧪 Just want a quick preview?

You can also run a static-only preview:

```sh
python3 -m http.server 8765 --directory public
```

Then visit **http://localhost:8765**.

Keep in mind: this only serves the UI and images. Dashboard stats, file management, uploads, likes, and comments need the Node.js server running.

## 🗂️ Explore the Dashboard

A little tour of what's inside!

| Page | What you'll find |
|---|---|
| `/` | **Dashboard** — CPU, memory, storage, uptime, host details, local daypart, and clock. Your server's health at a glance! |
| `/storage.html` | **Storage** — Browse files and folders, upload, sort, preview, and edit text or code files. |
| `/shorts.html` | **Shorts** — A vertically scrolling video feed with uploads, playback, likes, and comments. |
| `/repos.html` | **Repositories** — Manage local Git repositories, edit code, view changes, commit, switch branches, push remotely, preview READMEs, and manage releases. |
| `/minecraft.html` | **Minecraft** — Manage a Minecraft server with Java setup, file management, lifecycle controls, and its own dedicated console. |
| `/terminal.html` | **Operations Terminal** — Run built-in checks for your host and managed services. |

## 🌄 A Dashboard That Follows the Sun

Why settle for one background when you can have four?

The dashboard automatically switches backgrounds depending on your local time and even samples image colors to adapt the interface palette.

Place these images inside `public/assets/`:

| Image | Time |
|---|---|
| `morning.png` | 05:00–10:59 🌅 |
| `day.png` | 11:00–16:59 ☀️ |
| `evening.png` | 17:00–20:59 🌇 |
| `night.png` | 21:00–04:59 🌙 |

The page periodically checks the local time and switches to the matching image.

If an image is missing or fails to load, it'll fall back to `Mountain.jpg`.

## 🎮 Fun Facts

Here's a little secret about the dashboard's backgrounds:

**The background images were taken IN MINECRAFT!**

Yep. Not real-world landscape photography. They're Minecraft screenshots captured using the **"I Like Blu" shader**.

The shader gives the scenery a cooler, bluer and greyer atmosphere instead of the usual overly warm, yellow-orange lighting.

Minecraft screenshots doing the job of actual dashboard photography. Who needs stock wallpapers? 💀

## 💾 Storage & Data

Here's where everything lives behind the scenes:

| Location | Purpose |
|---|---|
| `data/files/` | Your uploaded files |
| `data/files/Shorts/` | Uploaded Shorts videos |
| `data/shorts.json` | Likes and comments |
| `data/repos/` | Local Git repositories |
| `data/minecraft/server/` | Managed Minecraft server |
| `data/minecraft/runtimes/` | Temurin Java runtimes |

These directories are created when needed and aren't served as public static files.

### ⛏️ Minecraft Manager

The Minecraft manager supports:

- One managed Minecraft server.
- Uploaded JARs or a browser-selected server folder.
- Explicit EULA acceptance.
- Java versions 8–25.
- Automatic Temurin installation on Linux x64 and arm64 hosts.
- Download checksum verification.
- A dedicated console connected only to the managed server process.

### 🖥️ Operations Terminal

The Operations Terminal runs built-in diagnostics and a configurable allowlist of host commands.

It doesn't implicitly invoke a shell or `sudo`.

To configure allowed commands, edit the `terminalAllowedCommands` array near the top of:

```text
public/js/terminal.js
```

Reload `/terminal.html` after changing it. The page sends the list to the running server, which validates it and keeps the submitted list in memory.

**Security note:** Allowed executables run with the Node server's permissions, so only add commands you trust. Arguments are passed directly, with shell operators and expansions disabled.

### ⚠️ Testing Mode

For temporary testing, you can start the server with:

```sh
TEST_MODE=true npm start
```

This bypasses the executable allowlist and allows arbitrary executables to run with the server's permissions.

The server prints a warning at startup.

Only use this on a trusted, isolated machine, and turn it off afterward!

## 🔌 API & Authentication

The first-party `/storage.html`, `/shorts.html`, `/repos.html`, and `/minecraft.html` pages can use their same-origin APIs without entering a token.

Other API clients must send:

```http
Authorization: Bearer <token>
```

By default, the server generates and prints a token at startup.

Want a stable token? Set:

```sh
FILES_API_TOKEN=your-token npm start
```

For a browser app running on another origin, set `CORS_ORIGIN` to that exact origin.

For all the technical details, check out **[API.md](API.md)**. It covers file, Shorts, Repos, Minecraft, and Operations Terminal API routes, payload formats, limits, and examples.

## 📁 Project Structure

```text
.
|-- server.js
|-- package.json
|-- API.md
|-- data/                 Created at runtime
`-- public/
    |-- assets/           Backgrounds and icons
    |-- css/              Shared and page-specific styles
    |-- js/               Dashboard, Storage, Shorts, Repos,
    |                      Minecraft, Terminal, and theme logic
    |-- index.html
    |-- storage.html
    |-- repos.html
    |-- minecraft.html
    |-- terminal.html
    `-- shorts.html
```

---

**Built for the home server experience. Powered by Node.js. Decorated with Minecraft scenery.** 🌌
