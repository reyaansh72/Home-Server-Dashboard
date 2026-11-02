const terminalAllowedCommands = ['date', 'df', 'free', 'hostname', 'id', 'ls', 'pwd', 'uname', 'uptime', 'whoami', 'fastfetch', 'git', 'npm', 'yarn', 'docker', 'docker-compose', 'kubectl', 'helm', 'aws', 'gcloud', 'az', 'terraform', 'ansible', 'ping', 'traceroute', 'curl', 'wget'];
const terminalOutput = document.getElementById('terminal-output');
const terminalInput = document.getElementById('terminal-command-input');
const terminalForm = document.getElementById('terminal-form');
const commandHistory = [];
let historyIndex = 0;

function appendTerminalEntry(command, output, error = false) {
    const entry = document.createElement('article');
    entry.className = `terminal-entry${error ? ' terminal-entry-error' : ''}`;
    const commandLine = document.createElement('div');
    commandLine.className = 'terminal-command-line';
    commandLine.textContent = `> ${command}`;
    const response = document.createElement('pre');
    response.className = 'terminal-entry-output';
    response.textContent = output;
    entry.append(commandLine, response);
    terminalOutput.append(entry);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

async function runOperation(command) {
    const status = document.getElementById('terminal-result-state');
    status.textContent = 'Running';
    try {
        const response = await fetch('/api/terminal', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Operation failed (${response.status})`);
        appendTerminalEntry(command, result.output);
        status.textContent = `Finished · ${new Date(result.time).toLocaleTimeString()}`;
    } catch (error) {
        appendTerminalEntry(command, `${error.message}. Host operations require the Node server.`, true);
        status.textContent = 'Failed';
    }
}

async function loadTerminalInfo() {
    try {
        const allowlistResponse = await fetch('/api/terminal', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allowedCommands: terminalAllowedCommands })
        });
        if (!allowlistResponse.ok) throw new Error('Could not configure terminal allowlist');
        const response = await fetch('/api/terminal', { cache: 'no-store' });
        if (!response.ok) throw new Error('Terminal API unavailable');
        const info = await response.json();
        document.getElementById('terminal-hostname').textContent = info.host;
        document.getElementById('terminal-cwd').textContent = `${info.host} · ${info.cwd}`;
        const shellCommands = info.shellCommands?.length ? info.shellCommands.join(', ') : 'none';
        const testModeWarning = info.testMode ? '\nWARNING: TEST_MODE is enabled; any executable command is allowed.' : '';
        appendTerminalEntry('help', `Connected to ${info.host}\nAvailable actions: ${info.actions.join(', ')}\nAllowed shell commands: ${shellCommands}\nCommands run without a shell; operators and expansions are disabled.${testModeWarning}`);
    } catch (error) {
        document.getElementById('terminal-hostname').textContent = 'Offline';
        document.getElementById('terminal-cwd').textContent = 'operations · disconnected';
        appendTerminalEntry('connect', `${error.message}. Run the Node server to use host operations.`, true);
    }
}

terminalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = terminalInput.value.trim();
    if (!command) return;
    commandHistory.push(command);
    historyIndex = commandHistory.length;
    terminalInput.value = '';
    runOperation(command);
});

terminalInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        historyIndex = Math.max(0, historyIndex - 1);
        terminalInput.value = commandHistory[historyIndex] || '';
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        historyIndex = Math.min(commandHistory.length, historyIndex + 1);
        terminalInput.value = commandHistory[historyIndex] || '';
    }
});

document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
    const command = button.dataset.command;
    commandHistory.push(command);
    historyIndex = commandHistory.length;
    runOperation(command);
}));

document.getElementById('clear-terminal').addEventListener('click', () => terminalOutput.replaceChildren());

loadTerminalInfo();
