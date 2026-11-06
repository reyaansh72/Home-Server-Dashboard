package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	webview "github.com/samcharles93/webview_go"
)

const (
	appName   = "Home Server Dashboard"
	appVersion = "1.0.0"
	configDir = "home-server-dashboard"
)

// ============================================================
// COLORED LOGGER
// ============================================================

const (
	resetColor  = "\033[0m"
	redColor    = "\033[31m"
	yellowColor = "\033[33m"
	cyanColor   = "\033[36m"
	greenColor  = "\033[92m"
	purpleColor = "\033[35m"
	grayColor   = "\033[90m"
)

var (
	logMutex   sync.Mutex
	logCounter uint64
	colorEnabled = os.Getenv("NO_COLOR") == "" &&
		os.Getenv("TERM") != "dumb"
)

func writeLog(level, color, format string, args ...any) {
	logMutex.Lock()
	defer logMutex.Unlock()

	logCounter++

	message := fmt.Sprintf(format, args...)
	timestamp := time.Now().Format("15:04:05.000")

	if colorEnabled {
		fmt.Printf(
			"%s[%s]%s %s[%-7s]%s #%04d %s\n",
			grayColor, timestamp, resetColor,
			color, level, resetColor,
			logCounter, message,
		)
	} else {
		fmt.Printf(
			"[%s] [%-7s] #%04d %s\n",
			timestamp, level, logCounter, message,
		)
	}
}

func info(message string, args ...any) {
	writeLog("INFO", cyanColor, message, args...)
}

func success(message string, args ...any) {
	writeLog("SUCCESS", greenColor, message, args...)
}

func warning(message string, args ...any) {
	writeLog("WARNING", yellowColor, message, args...)
}

func errorLog(message string, args ...any) {
	writeLog("ERROR", redColor, message, args...)
}

func debug(message string, args ...any) {
	writeLog("DEBUG", purpleColor, message, args...)
}

func requestLog(message string, args ...any) {
	writeLog("REQUEST", greenColor, message, args...)
}

func separator() {
	info("------------------------------------------------------------")
}

// ============================================================
// CONFIGURATION
// ============================================================

type Config struct {
	ServerURL string `json:"server_url"`
}

func getConfigPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(dir, configDir, "config.json"), nil
}

func validateURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)

	u, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("invalid URL")
	}

	if (u.Scheme != "http" && u.Scheme != "https") ||
		u.Hostname() == "" {
		return "", errors.New(
			"URL must start with http:// or https://",
		)
	}

	if u.User != nil {
		return "", errors.New("credentials in server URLs are not allowed")
	}

	return u.String(), nil
}

func sanitizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "<invalid-url>"
	}

	u.RawQuery = ""
	u.Fragment = ""

	return u.String()
}

func loadConfig() (Config, error) {
	path, err := getConfigPath()
	if err != nil {
		return Config{}, err
	}

	debug("Reading configuration: %s", path)

	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}

	var config Config

	if err := json.Unmarshal(data, &config); err != nil {
		return Config{}, err
	}

	config.ServerURL, err = validateURL(config.ServerURL)
	if err != nil {
		return Config{}, err
	}

	return config, nil
}

func saveConfig(config Config) error {
	path, err := getConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)

	info("Creating configuration directory")

	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}

	tmp := path + ".tmp"

	info("Writing configuration file")

	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}

	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}

	success("Configuration saved securely")

	return nil
}

// ============================================================
// SERVER CONNECTION CHECK
// ============================================================

func checkServer(serverURL string) error {
	info("Checking server connectivity...")

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	req, err := http.NewRequest(
		http.MethodGet,
		serverURL,
		nil,
	)
	if err != nil {
		return err
	}

	start := time.Now()

	requestLog(
		"-> GET %s [CONNECTION CHECK]",
		sanitizeURL(serverURL),
	)

	resp, err := client.Do(req)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		errorLog("Connection failed: %v", err)
		return err
	}

	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		errorLog(
			"Server returned HTTP %d (%dms)",
			resp.StatusCode,
			duration,
		)

		return fmt.Errorf(
			"server returned HTTP %d",
			resp.StatusCode,
		)
	}

	success(
		"Server responded with HTTP %d (%dms)",
		resp.StatusCode,
		duration,
	)

	return nil
}

// ============================================================
// BROWSER API REQUEST MONITOR
// ============================================================

type BrowserRequest struct {
	Method   string `json:"method"`
	URL      string `json:"url"`
	Phase    string `json:"phase"`
	Status   int    `json:"status"`
	Duration int64  `json:"duration"`
	Error    string `json:"error"`
}

func handleBrowserRequest(event BrowserRequest) {
	method := strings.ToUpper(event.Method)

	if method == "" {
		method = "UNKNOWN"
	}

	target := sanitizeURL(event.URL)

	switch event.Phase {
	case "start":
		requestLog(
			"-> %s %s",
			method,
			target,
		)

	case "success":
		success(
			"<- %s %s | HTTP %d | %dms",
			method,
			target,
			event.Status,
			event.Duration,
		)

	case "failure":
		errorLog(
			"<- %s %s | HTTP %d | %dms | %s",
			method,
			target,
			event.Status,
			event.Duration,
			event.Error,
		)

	case "network_error":
		errorLog(
			"<- %s %s | NETWORK ERROR | %dms | %s",
			method,
			target,
			event.Duration,
			event.Error,
		)

	default:
		debug(
			"Unknown browser request event: %+v",
			event,
		)
	}
}

// ============================================================
// JAVASCRIPT REQUEST MONITOR
// ============================================================

const browserRequestLoggerJS = `
(() => {
    if (window.__dashboardRequestLoggerInstalled) return;

    window.__dashboardRequestLoggerInstalled = true;

    const report = (
        method,
        url,
        phase,
        status,
        duration,
        error
    ) => {
        try {
            if (typeof window.logBrowserRequest === "function") {
                window.logBrowserRequest({
                    method: method || "UNKNOWN",
                    url: String(url || ""),
                    phase: phase,
                    status: status || 0,
                    duration: Math.round(duration || 0),
                    error: error ? String(error) : ""
                });
            }
        } catch (_) {}
    };

    // FETCH MONITOR

    const originalFetch = window.fetch;

    window.fetch = function(input, init) {
        const method = (
            (init && init.method) ||
            (input instanceof Request && input.method) ||
            "GET"
        ).toUpperCase();

        const url = input instanceof Request
            ? input.url
            : String(input);

        const started = performance.now();

        report(method, url, "start", 0, 0, "");

        return originalFetch.apply(this, arguments)
            .then(response => {
                const duration = performance.now() - started;

                report(
                    method,
                    url,
                    response.status >= 400
                        ? "failure"
                        : "success",
                    response.status,
                    duration,
                    response.status >= 400
                        ? response.statusText
                        : ""
                );

                return response;
            })
            .catch(error => {
                report(
                    method,
                    url,
                    "network_error",
                    0,
                    performance.now() - started,
                    error.message || error
                );

                throw error;
            });
    };

    // XMLHTTPREQUEST MONITOR

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__dashboardMethod = method;
        this.__dashboardURL = url;

        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        const xhr = this;

        const method = xhr.__dashboardMethod || "GET";
        const url = xhr.__dashboardURL || "";

        const started = performance.now();

        report(method, url, "start", 0, 0, "");

        xhr.addEventListener("loadend", function() {
            const duration = performance.now() - started;
            const status = xhr.status;

            if (status >= 200 && status < 400) {
                report(
                    method,
                    url,
                    "success",
                    status,
                    duration,
                    ""
                );
            } else {
                report(
                    method,
                    url,
                    status === 0
                        ? "network_error"
                        : "failure",
                    status,
                    duration,
                    xhr.statusText || "Request failed"
                );
            }
        }, { once: true });

        return originalSend.apply(this, arguments);
    };

    console.info(
        "[Home Server Dashboard] Request monitoring enabled"
    );
})();
`

// ============================================================
// FIRST LAUNCH SETUP UI
// ============================================================

const setupHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>Home Server Dashboard Setup</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #111318;
    color: #ffffff;
    font-family: sans-serif;
    display: grid;
    place-items: center;
    min-height: 100vh;
}

.card {
    width: min(440px, 90%);
    background: #1c2029;
    padding: 32px;
    border-radius: 18px;
}

h1 {
    font-size: 25px;
}

p {
    color: #aeb6c5;
    line-height: 1.5;
}

input {
    width: 100%;
    padding: 14px;
    margin-top: 12px;
    background: #111318;
    border: 1px solid #414858;
    border-radius: 9px;
    color: white;
    font-size: 15px;
}

button {
    width: 100%;
    padding: 14px;
    margin-top: 18px;
    border: none;
    border-radius: 9px;
    background: #3987f6;
    color: white;
    font-size: 15px;
    font-weight: bold;
    cursor: pointer;
}

button:disabled {
    opacity: 0.6;
    cursor: wait;
}

#status {
    margin-top: 14px;
    font-size: 13px;
    color: #aeb6c5;
}
</style>
</head>

<body>

<div class="card">

    <h1>Home Server Dashboard</h1>

    <p>
        Welcome to the Linux companion app.
        Enter the URL of your running Home Server Dashboard server.
    </p>

    <form id="setupForm">

        <input
            id="serverURL"
            type="url"
            placeholder="http://192.168.1.10:3010"
            required
        >

        <button id="connectButton" type="submit">
            Save and Connect
        </button>

    </form>

    <div id="status"></div>

</div>

<script>

const form = document.getElementById("setupForm");
const input = document.getElementById("serverURL");
const button = document.getElementById("connectButton");
const status = document.getElementById("status");

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    button.disabled = true;
    status.textContent = "Saving configuration...";

    try {
        const result = await window.saveServerURL(input.value);

        status.textContent = result;
    } catch (error) {
        status.textContent = "Error: " + error;
        button.disabled = false;
    }
});

</script>

</body>
</html>
`

func setupServer() (string, error) {
	separator()

	info("First launch detected")
	info("Opening setup window")

	w, err := webview.NewWithOptions(webview.Options{
		Title:  appName + " - Setup",
		Width:  550,
		Height: 430,
		HTML:   setupHTML,
	})

	if err != nil {
		errorLog("Setup WebView creation failed: %v", err)
		return "", err
	}

	defer w.Destroy()

	var savedURL string

	err = w.Bind(
		"saveServerURL",
		func(raw string) (string, error) {
			info("Setup form submitted")

			serverURL, err := validateURL(raw)
			if err != nil {
				warning("Invalid server URL: %v", err)
				return "", err
			}

			config := Config{
				ServerURL: serverURL,
			}

			if err := saveConfig(config); err != nil {
				errorLog(
					"Could not save configuration: %v",
					err,
				)
				return "", err
			}

			savedURL = serverURL

			success(
				"Server URL configured: %s",
				sanitizeURL(serverURL),
			)

			if err := w.Terminate(); err != nil {
				warning(
					"Could not close setup window: %v",
					err,
				)
			}

			return "Saved! Opening Home Server Dashboard...", nil
		},
	)

	if err != nil {
		errorLog("Could not register setup callback: %v", err)
		return "", err
	}

	info("Waiting for server URL")

	if err := w.Run(); err != nil {
		errorLog("Setup window runtime error: %v", err)
		return "", err
	}

	if savedURL == "" {
		return "", errors.New(
			"setup closed without saving a URL",
		)
	}

	success("Setup completed")

	return savedURL, nil
}

// ============================================================
// MAIN DASHBOARD
// ============================================================

func openDashboard(serverURL string) error {
	separator()

	info("Initializing dashboard WebView")

	w, err := webview.NewWithOptions(webview.Options{
		Title:  appName,
		Width:  1200,
		Height: 800,
		Debug:  false,
	})

	if err != nil {
		errorLog(
			"WebView initialization failed: %v",
			err,
		)
		return err
	}

	defer w.Destroy()

	success("WebView initialized")

	info("Registering browser request monitor")

	if err := w.Bind(
		"logBrowserRequest",
		handleBrowserRequest,
	); err != nil {
		errorLog(
			"Could not register request monitor: %v",
			err,
		)
		return err
	}

	success("Browser request monitor registered")

	info("Injecting JavaScript monitoring")

	if err := w.Init(browserRequestLoggerJS); err != nil {
		errorLog(
			"JavaScript injection failed: %v",
			err,
		)
		return err
	}

	success("Request monitoring injected")

	info("Checking server availability")

	if err := checkServer(serverURL); err != nil {
		warning(
			"Server is unreachable. Opening dashboard anyway.",
		)
	}

	info(
		"Navigating to dashboard: %s",
		sanitizeURL(serverURL),
	)

	if err := w.Navigate(serverURL); err != nil {
		errorLog("Navigation failed: %v", err)
		return err
	}

	success("Dashboard navigation started")

	separator()

	info("Dashboard is running")
	info("Browser API monitoring is active")
	info("Waiting for dashboard events...")

	start := time.Now()

	if err := w.Run(); err != nil {
		errorLog("WebView runtime error: %v", err)
		return err
	}

	info(
		"Dashboard session duration: %s",
		time.Since(start).Round(time.Second),
	)

	success("Dashboard window closed")

	return nil
}

// ============================================================
// APPLICATION ENTRY POINT
// ============================================================

func main() {
	startup := time.Now()

	fmt.Println()

	separator()

	success("%s", appName)
	info("Version: %s", appVersion)
	info("Platform: Linux")
	info("Logger: Colored console logger")
	info("Network monitor: Enabled")

	separator()

	info("Starting application...")

	configPath, pathErr := getConfigPath()

	if pathErr == nil {
		debug("Configuration path: %s", configPath)
	}

	info("Loading configuration")

	config, err := loadConfig()

	var serverURL string

	if err == nil {
		success("Configuration loaded successfully")

		serverURL = config.ServerURL

		info(
			"Configured server: %s",
			sanitizeURL(serverURL),
		)
	} else {
		if !errors.Is(err, os.ErrNotExist) {
			warning(
				"Configuration unavailable: %v",
				err,
			)
		} else {
			info("No existing configuration found")
		}

		info("Starting initial configuration wizard")

		serverURL, err = setupServer()
		if err != nil {
			errorLog("Setup failed: %v", err)
			os.Exit(1)
		}

		success("Initial configuration completed")
	}

	success(
		"Startup configuration completed in %s",
		time.Since(startup).Round(time.Millisecond),
	)

	info("Connecting to Home Server Dashboard")

	if err := openDashboard(serverURL); err != nil {
		errorLog("Dashboard failed: %v", err)
		os.Exit(1)
	}

	separator()

	success("Application exited successfully")

	info(
		"Total application runtime: %s",
		time.Since(startup).Round(time.Second),
	)

	separator()
}