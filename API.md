# Storage API

The server stores files under `data/files/` and shared music under `data/music/`. First-party dashboard pages, including `/music.html` and `/chat.html`, can use their same-origin APIs without a token. Other API clients, including other pages on the same host, must send the bearer token printed at server startup. To use a stable token, set `FILES_API_TOKEN` before starting the server.

The server listens on `0.0.0.0` by default, as the dashboard did previously. Restrict access to a trusted LAN/firewall. For apps running on a different browser origin, set `CORS_ORIGIN` to that exact origin (for example `https://my-app.example`). Do not use a public origin for this private file API.

```sh
FILES_API_TOKEN='replace-with-a-long-random-secret' CORS_ORIGIN='https://my-app.example' npm start
```

Send `Authorization: Bearer <token>` with each request. JSON request bodies use `Content-Type: application/json` unless noted.

## Endpoints

- `GET /api/files?path=folder&sort=name&direction=asc` lists a folder. Sort keys: `name`, `modified`, `size`, `type`. Directories appear before files.
- `GET /api/files/all` recursively lists file metadata for global search, Recent, and Starred views.
- `GET /api/files/content?path=notes.txt` reads a UTF-8 text file (up to 2 MiB).
- `PUT /api/files/content?path=notes.txt` replaces a text file's contents; send raw UTF-8 text, up to 2 MiB.
- `GET /api/files/download?path=photo.jpg` downloads a file.
- `GET /api/files/preview?path=report.pdf` serves a PDF inline for preview.
- `POST /api/files/folder` creates a folder: `{ "path": "parent", "name": "New folder" }`.
- `POST /api/files/create` creates a text file: `{ "path": "parent", "name": "notes.txt", "content": "Hello" }`.
- `POST /api/files/upload?path=parent&name=photo.jpg` uploads raw file bytes (up to 250 MiB).
- `POST /api/files/rename` renames an item: `{ "path": "old/name.txt", "name": "new-name.txt" }`.
- `POST /api/files/duplicate` copies a file or folder: `{ "path": "folder/name.txt" }`. An optional `name` sets the copy's name.
- `POST /api/files/move` moves an item: `{ "path": "old/name.txt", "targetPath": "destination" }`. Use an empty target path for the storage root.
- `DELETE /api/files?path=folder/name.txt` deletes a file or folder recursively. The storage root cannot be deleted.

All paths are relative to `data/files/`. Traversal segments and symbolic links are rejected. Existing items are not overwritten by create, upload, rename, or move operations.

## Example

```js
const response = await fetch('http://localhost:3000/api/files?path=Projects', {
  headers: { Authorization: `Bearer ${process.env.FILES_API_TOKEN}` }
});
const { entries } = await response.json();
```

## Shorts API

Short videos are stored under `data/files/Shorts/`. The Shorts page supports MP4, WebM, MOV, and M4V uploads up to 250 MiB. Requests from the same-origin `/shorts.html` page are token-free; custom apps use the same bearer token described above.

- `GET /api/shorts?viewerId=...` lists the feed with like state and comments for that browser viewer ID.
- `POST /api/shorts` registers an uploaded video: `{ "path": "Shorts/clip.mp4", "caption": "A short caption", "userId": "<shared-profile-uuid>" }`. The uploader name and avatar come from that profile.
- `GET /api/shorts/:id/video` streams a clip and supports HTTP byte ranges for seeking.
- `POST /api/shorts/:id/like` toggles a like: `{ "viewerId": "stable-client-id" }`.
- `POST /api/shorts/:id/comments` adds a comment: `{ "viewerId": "stable-client-id", "userId": "<shared-profile-uuid>", "text": "Nice clip" }`. The commenter name and avatar come from the shared profile.
- `DELETE /api/shorts/:id` deletes the clip and its associated comments and likes.

Likes and comments are stored in `data/shorts.json`. The feed offers snap scrolling, auto-play/pause based on the visible clip, mute, fullscreen, download, share-link copy, and delete actions. Responsive layout rules adapt the feed to phones, tablets, and desktops.

## Music API

The shared music catalog is stored in `data/music/music.json`, with audio files in `data/music/`. The same-origin `/music.html` and `/chat.html` pages can access the API without a token. Track uploader names are display labels; the dashboard does not provide authenticated user accounts.

- `GET /api/music` lists globally available tracks and their metadata.
- `POST /api/music?name=<filename>&title=<title>&artist=<artist>&userId=<shared-profile-uuid>` uploads raw audio bytes (up to 250 MiB). Supported extensions: AAC, FLAC, M4A, MP3, OGA, OGG, OPUS, WAV. Uploader name and logo are taken from the shared profile.
- `GET /api/music/:id/audio` streams a track inline and supports HTTP byte ranges for seeking.
- `PUT /api/music/:id` updates metadata with `{ "userId": "<shared-profile-uuid>", "title": "Track title", "artist": "Artist" }`.
- `DELETE /api/music/:id?userId=<shared-profile-uuid>` removes a track from the library. Audio already shared in chat is retained so existing messages keep playing.

The player supports seek, volume, playback speed, shuffle, and repeat modes. Global Chat can post and render music references using the `musicId` message field; the audio itself stays in the shared library.

## Repositories API

Repositories created in the Repos page are stored under `data/repos/`. The same-origin `/repos.html` page does not need a token; external clients must use the bearer token. Git is invoked with fixed argument lists, repository names and file paths are confined to the repo root, and local Git hooks are disabled for commit, tag, and push actions.

- `GET /api/repos` lists local repositories.
- `POST /api/repos` creates a repository with an initial `README.md`: `{ "name": "my-project", "description": "Project summary", "userId": "<shared-profile-uuid>" }`. The creator's shared profile name and logo are stored for attribution.
- `GET /api/repos/:name/status` returns current branch, upstream, ahead/behind counts, changed files, and configured origin URL.
- `GET /api/repos/:name/tree?path=src` lists files in a repository folder.
- `GET /api/repos/:name/file?path=src/index.js` reads a text file (up to 2 MiB).
- `PUT /api/repos/:name/file?path=src/index.js` creates or replaces a text file (up to 2 MiB).
- `DELETE /api/repos/:name/file?path=src/index.js` deletes a file.
- `GET /api/repos/:name/branches` lists local branches and the current branch.
- `POST /api/repos/:name/branches` creates and switches to a branch: `{ "name": "feature/example" }`.
- `POST /api/repos/:name/checkout` switches to an existing local branch: `{ "name": "main" }`.
- `GET /api/repos/:name/history` returns the latest 50 commits.
- `POST /api/repos/:name/commit` stages all changes and commits them: `{ "message": "Describe the change" }`.
- `PUT /api/repos/:name/remote` adds or updates the `origin` remote. HTTPS and SSH URLs are accepted: `{ "url": "https://example.com/user/repo.git" }`.
- `POST /api/repos/:name/push` pushes the current branch to `origin` (or `?remote=name`). Git credentials must already be configured on the server.
- `GET /api/repos/:name/releases` lists annotated Git tags.
- `POST /api/repos/:name/releases` creates an annotated tag on `HEAD`: `{ "tag": "v1.0.0", "message": "Release notes" }`.

The Repos UI offers Code, Changes, Commits, README, and Releases views. CodeMirror provides syntax highlighting and line numbers; Markdown README previews are sanitized before display. Pushing contacts the configured remote and should only be used with a remote you control.

## Minecraft Manager API

The manager supports one server in `data/minecraft/server/`; Java runtimes are stored in `data/minecraft/runtimes/`. The same-origin `/minecraft.html` page uses first-party access. Java runtime installs use Eclipse Temurin HTTPS downloads and verify SHA-256 checksums. Automatic Java installation currently supports Linux x64 and arm64 hosts.

- `GET /api/minecraft` returns configuration, runtime install state, process state, and recent Minecraft console output.
- `POST /api/minecraft/config` creates the one managed server: `{ "name": "My Server", "javaVersion": 21, "ramMb": 2048, "jarFile": "server.jar", "mode": "jar", "eulaAccepted": true }`. `mode` may be `jar` or `folder`; EULA acceptance is required.
- `PUT /api/minecraft/config` updates the server name, Java version, or RAM limit.
- `DELETE /api/minecraft` stops and removes the managed server directory and configuration.
- `POST /api/minecraft/upload?path=server.jar` streams a file into the managed server folder (up to 1 GiB per file).
- `GET /api/minecraft/files?path=world` lists a server folder.
- `POST /api/minecraft/folder` creates a folder: `{ "path": "", "name": "backups" }`.
- `GET /api/minecraft/file?path=server.properties` reads a text file (up to 2 MiB).
- `PUT /api/minecraft/file?path=server.properties` creates or replaces a text file (up to 2 MiB).
- `DELETE /api/minecraft/file?path=old.txt` deletes a server file.
- `GET /api/minecraft/download?path=logs/latest.log` downloads a server file; `GET /api/minecraft/preview?path=server.properties` serves an inline preview.
- `POST /api/minecraft/install-java` installs a Temurin runtime: `{ "version": 21 }`. Supported versions are 8 through 25.
- `POST /api/minecraft/start` starts the configured server with its selected Java runtime and memory limit.
- `POST /api/minecraft/stop` stops the server process.
- `POST /api/minecraft/console` sends a command to the Minecraft process stdin: `{ "command": "list" }`.

Paths are relative to the managed server directory; traversal segments and symlinks are rejected. File editing and uploads are blocked while the server is running. The EULA checkbox writes `eula=true` to `eula.txt` before launch; read and accept the [Minecraft EULA](https://www.minecraft.net/eula) before creating a server.

## Operations Terminal API

The separate `/terminal.html` page runs built-in diagnostics and a configurable allowlist of host commands. Edit the `terminalAllowedCommands` array near the top of `public/js/terminal.js` and reload the page to send the list to the server. The server validates and keeps the submitted list in memory; allowed executables run with the Node server's permissions. Commands are launched directly, with shell operators and expansions rejected. Only add commands you trust.

Setting `TEST_MODE=true` when starting the server bypasses the allowlist and permits any executable command. A prominent warning is printed at server startup. Use this only for testing on a trusted, isolated machine and disable it afterward.

- `GET /api/terminal` returns host info, built-in action names, the configured shell executable allowlist, and whether test mode is enabled.
- `POST /api/terminal` accepts `{ "allowedCommands": ["date", "df", "whoami"] }` to replace the in-memory allowlist. The list may contain up to 100 executable names.
- `POST /api/terminal` accepts `{ "command": "status" }` for a built-in action or `{ "command": "df -h" }` for an allowed executable and its arguments. Commands have a 15-second timeout and a 1 MiB output limit.

Built-in actions are `help`, `status`, `uptime`, `disk`, `memory`, `repos`, and `minecraft`. Minecraft commands belong in the separate Minecraft Console and are sent to the managed Minecraft process stdin.

## Global Chat API

Chat profiles, messages, reactions, pins, file comments, and attachment metadata are stored in `data/chat/chat.json`; uploaded files live in `data/chat/uploads/`. The chat is global to the server and has no account authentication, so expose it only to a trusted network. Client profile IDs are browser-generated identifiers, not credentials.

- `GET /api/chat?userId=<uuid>` returns the requesting browser profile, latest 250 messages, replies, reactions, attachment metadata, shared music metadata, and pinned messages.
- `POST /api/chat/profile` saves a profile: `{ "userId": "<uuid>", "username": "Name", "avatarId": "<uploaded-file-id>" }`. Set `avatarId` to `null` to remove the avatar.
- `POST /api/chat/upload?userId=<uuid>&kind=avatar|attachment|voice&name=<filename>` uploads raw file bytes. Avatars are limited to 5 MiB, voice notes to 15 MiB, and other attachments to 50 MiB. Supported types are images, MP4/WebM/MOV video, audio for voice notes, PDF, text, Markdown, CSV, and ZIP.
- `GET /api/chat/files/:id/content` serves an image/audio/video inline or downloads a document.
- `POST /api/chat/messages` posts `{ "userId": "<uuid>", "text": "Hello", "fileId": "<optional-file-id>", "musicId": "<optional-track-id>", "replyTo": "<optional-message-id>" }`. A music-only message can be sent with an empty `text` and a valid `musicId`.
- `PUT /api/chat/messages/:id` edits the caller's own message with `{ "userId": "<uuid>", "text": "Updated" }`.
- `DELETE /api/chat/messages/:id` removes the caller's own message with `{ "userId": "<uuid>" }`.
- `POST /api/chat/messages/:id/reactions` toggles a reaction with `{ "userId": "<uuid>", "emoji": "👍" }`.
- `POST /api/chat/messages/:id/pin` pins or unpins with `{ "userId": "<uuid>", "pinned": true }`.
- `POST /api/chat/files/:id/comments` comments on an uploaded file with `{ "userId": "<uuid>", "text": "Nice photo" }`.
