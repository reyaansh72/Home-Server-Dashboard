# Home Server Dashboard — Linux Client

The official Linux desktop companion for [Home Server Dashboard](https://github.com/reyaansh72/Home-Server-Dashboard).

## Features

- Opens your Home Server Dashboard in a native desktop window.
- Saves your server URL locally after first-time setup.
- Automatically connects to your saved server on future launches.
- Logs application events in the terminal.

## Requirements

- Go
- GTK4
- WebKitGTK 6.0
- `pkg-config`
- A running Home Server Dashboard instance

## Build

From this directory:

```bash
go mod tidy
go build -o home-server-dashboard .
```

## Run

```bash
./home-server-dashboard
```

On first launch, enter your Home Server URL. The client saves it for future launches.

## Configuration

Configuration is stored at:

```text
~/.config/home-server-dashboard/config.json
```

## Project Structure

```text
linux/
├── go.mod
├── go.sum
├── main.go
└── README.md
```

## License

See the main repository for license information.
