const statusText = document.getElementById('minecraft-status-text');
const statusPill = document.getElementById('minecraft-status-pill');
const createDialog = document.getElementById('minecraft-create-dialog');
const renameDialog = document.getElementById('minecraft-rename-dialog');
const jarInput = document.getElementById('mc-jar-file');
const folderInput = document.getElementById('mc-folder-files');
const minecraftEditorTextarea = document.getElementById('mc-editor');
let minecraftState = null;
let minecraftEditor = null;
let fileDirectory = '';
let openedMinecraftFile = '';
let originalMinecraftContent = '';
let consoleLength = 0;
let refreshTimer;
let statusTimer;
const configuredJavaVersion = 21;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

async function apiRequest(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
    }
    return response;
}

function showMessage(message, isError = false) {
    window.clearTimeout(statusTimer);
    const element = document.getElementById('minecraft-message');
    element.textContent = message;
    element.classList.toggle('error', isError);
    if (message) statusTimer = window.setTimeout(() => { element.textContent = ''; }, 5000);
}

function initMinecraftEditor() {
    if (minecraftEditor || !window.CodeMirror) return;
    minecraftEditor = CodeMirror.fromTextArea(minecraftEditorTextarea, { theme: 'material-darker', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, indentUnit: 4, tabSize: 4, lineWrapping: false, extraKeys: { 'Ctrl-S': saveMinecraftFile, 'Cmd-S': saveMinecraftFile } });
}

function paintMinecraftState(state) {
    minecraftState = state;
    document.getElementById('minecraft-empty').hidden = state.configured;
    document.getElementById('minecraft-workspace').hidden = !state.configured;
    statusText.textContent = state.running ? 'Running' : state.configured ? 'Stopped' : 'Not configured';
    statusPill.classList.toggle('running', state.running);
    if (!state.configured) return;

    document.getElementById('minecraft-name').textContent = state.name;
    document.getElementById('minecraft-details').textContent = `Java ${state.javaVersion} · ${state.ramMb} MB RAM · ${state.jarFile}`;
    document.getElementById('minecraft-pid').textContent = state.running ? `PID ${state.pid}` : '';
    document.getElementById('start-minecraft').disabled = state.running || state.installInProgress;
    document.getElementById('stop-minecraft').disabled = !state.running;
    document.getElementById('overview-server-state').textContent = state.running ? 'Running' : 'Stopped';
    document.getElementById('overview-server-meta').textContent = state.running ? `Process ${state.pid} · managed server` : 'Server process is not running';
    document.getElementById('overview-java-version').textContent = `Java ${state.javaVersion}`;
    document.getElementById('overview-java-installed').textContent = state.installedJavaVersions.includes(state.javaVersion) ? 'Runtime installed' : 'Runtime not installed yet';
    document.getElementById('overview-ram').textContent = `${state.ramMb} MB`;
    document.getElementById('runtime-version-label').textContent = `Java ${state.javaVersion}`;
    document.getElementById('runtime-setup-copy').textContent = state.installedJavaVersions.includes(state.javaVersion)
        ? `Java ${state.javaVersion} is installed and ready. It will not be changed automatically.`
        : `Java ${state.javaVersion} is required. Install it here before starting the server.`;
    updateRuntimeInstallButton();
    const javaInstalled = state.installedJavaVersions.includes(state.javaVersion);
    const startButton = document.getElementById('start-minecraft');
    startButton.disabled = state.running || state.installInProgress || !javaInstalled;
    startButton.title = javaInstalled ? 'Start Minecraft server' : `Install Java ${state.javaVersion} in Runtime setup first`;
    startButton.querySelector('span').textContent = javaInstalled ? 'play_arrow' : 'download';
    startButton.lastChild.textContent = javaInstalled ? 'Start' : 'Java required';
    renderMinecraftConsole(state.logs || []);
}

function updateRuntimeInstallButton() {
    const version = minecraftState?.javaVersion || configuredJavaVersion;
    const installed = minecraftState?.installedJavaVersions.includes(version);
    const button = document.getElementById('install-runtime');
    button.disabled = Boolean(minecraftState?.installInProgress || installed);
    button.title = installed ? `Java ${version} is already installed` : `Install Java ${version}`;
}

async function loadMinecraftStatus() {
    try {
        const response = await apiRequest('/api/minecraft');
        paintMinecraftState(await response.json());
    } catch (error) {
        statusText.textContent = 'Offline';
        statusPill.classList.remove('running');
        document.getElementById('minecraft-empty').hidden = false;
        document.getElementById('minecraft-workspace').hidden = true;
        showMessage(`${error.message}. Start the Node server to manage Minecraft.`, true);
    }
}

function renderMinecraftConsole(logs) {
    const output = document.getElementById('mc-console-output');
    if (logs.length < consoleLength) {
        output.replaceChildren();
        consoleLength = 0;
    }
    const unseen = logs.slice(consoleLength);
    const fragment = document.createDocumentFragment();
    for (const log of unseen) {
        const line = document.createElement('div');
        line.className = 'mc-console-line';
        const timestamp = document.createElement('time');
        timestamp.textContent = new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const text = document.createElement('span');
        text.textContent = log.text;
        line.append(timestamp, text);
        fragment.append(line);
    }
    output.append(fragment);
    consoleLength = logs.length;
    output.scrollTop = output.scrollHeight;
}

async function uploadServerFile(file, relativePath) {
    const query = new URLSearchParams({ path: relativePath });
    await apiRequest(`/api/minecraft/upload?${query}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
}

async function createMinecraftServer(event) {
    event.preventDefault();
    const source = document.querySelector('input[name="mc-source"]:checked').value;
    const files = source === 'jar' ? [jarInput.files[0]].filter(Boolean) : [...folderInput.files];
    if (!files.length) return showMessage(source === 'jar' ? 'Choose a server JAR first.' : 'Choose a server folder first.', true);
    if (!document.getElementById('mc-eula-check').checked) return showMessage('Accept the Minecraft EULA to continue.', true);

    const name = document.getElementById('mc-name-input').value.trim();
    const javaVersion = configuredJavaVersion;
    const ramMb = Number(document.getElementById('mc-ram-input').value);
    const jarFile = document.getElementById('mc-jar-name').value.trim() || 'server.jar';
    if (!jarFile.toLowerCase().endsWith('.jar')) return showMessage('Server JAR path must end in .jar.', true);
    if (source === 'jar' && !files[0].name.toLowerCase().endsWith('.jar')) return showMessage('Choose a server JAR file.', true);
    if (source === 'folder') {
        const importedPaths = files.map((file) => {
            const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
            return parts.length > 1 ? parts.slice(1).join('/') : parts[0];
        });
        if (!jarFile.toLowerCase().endsWith('.jar') || !importedPaths.includes(jarFile)) {
            return showMessage(`The selected server folder does not contain ${jarFile}. Choose a JAR path from the imported folder.`, true);
        }
    }
    const button = document.getElementById('mc-create-submit');
    button.disabled = true;
    button.lastChild.textContent = 'Creating server';
    showMessage('Creating server workspace...');
    let configCreated = false;

    try {
        await apiRequest('/api/minecraft/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, javaVersion, ramMb, jarFile, mode: source, eulaAccepted: true }) });
        configCreated = true;
        if (source === 'jar') {
            await uploadServerFile(files[0], jarFile);
        } else {
            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
                const relativePath = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
                showMessage(`Importing ${index + 1} of ${files.length}: ${relativePath}`);
                await uploadServerFile(file, relativePath);
            }
        }
        createDialog.close();
        showMessage(`Minecraft server created. Install Java ${javaVersion} in Runtime setup before starting.`);
        await loadMinecraftStatus();
        await loadMinecraftFiles('');
    } catch (error) {
        let message = error.message;
        if (configCreated) {
            try {
                await apiRequest('/api/minecraft', { method: 'DELETE' });
                message += ' The incomplete server setup was rolled back; you can try again.';
            } catch (rollbackError) {
                message += ` Cleanup failed: ${rollbackError.message}`;
            }
        }
        showMessage(message, true);
        await loadMinecraftStatus();
    } finally { button.disabled = false; }
    button.lastChild.textContent = 'Create server';
}

async function installJava() {
    const version = minecraftState?.javaVersion || configuredJavaVersion;
    const button = document.getElementById('install-runtime');
    button.disabled = true;
    showMessage(`Installing Temurin Java ${version}... This may take a few minutes.`);
    try {
        await apiRequest('/api/minecraft/install-java', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
        showMessage(`Java ${version} installed and checksum verified.`);
        await loadMinecraftStatus();
    } catch (error) { showMessage(error.message, true); }
    finally { updateRuntimeInstallButton(); }
}

async function startMinecraft() {
    const button = document.getElementById('start-minecraft');
    if (!minecraftState?.installedJavaVersions.includes(minecraftState.javaVersion)) {
        showMessage(`Install Java ${minecraftState?.javaVersion || ''} in Runtime setup before starting the server.`, true);
        return;
    }
    button.disabled = true;
    showMessage('Starting Minecraft server...');
    try {
        await apiRequest('/api/minecraft/start', { method: 'POST' });
        showMessage('Minecraft server starting.');
        await loadMinecraftStatus();
        setMinecraftView('console');
    } catch (error) { showMessage(error.message, true); }
    finally { button.disabled = false; }
}

async function stopMinecraft() {
    document.getElementById('stop-minecraft').disabled = true;
    try {
        await apiRequest('/api/minecraft/stop', { method: 'POST' });
        showMessage('Minecraft server stopped.');
        await loadMinecraftStatus();
    } catch (error) { showMessage(error.message, true); }
}

async function deleteMinecraft() {
    if (!window.confirm('Stop and permanently delete the managed Minecraft server and all its files?')) return;
    try {
        await apiRequest('/api/minecraft', { method: 'DELETE' });
        fileDirectory = '';
        openedMinecraftFile = '';
        document.getElementById('mc-file-tree').replaceChildren();
        if (minecraftEditor) minecraftEditor.setValue('');
        showMessage('Minecraft server and files deleted.');
        await loadMinecraftStatus();
    } catch (error) { showMessage(error.message, true); }
}

async function renameMinecraft(event) {
    event.preventDefault();
    const name = document.getElementById('mc-rename-input').value.trim();
    try {
        await apiRequest('/api/minecraft/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        renameDialog.close();
        await loadMinecraftStatus();
        showMessage('Server renamed.');
    } catch (error) { showMessage(error.message, true); }
}

function switchMinecraftTab(view) {
    document.querySelectorAll('.minecraft-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mcView === view));
    document.querySelectorAll('.minecraft-view').forEach((panel) => panel.classList.toggle('active-minecraft-view', panel.id === `minecraft-view-${view}`));
    if (view === 'files') {
        loadMinecraftFiles(fileDirectory).catch((error) => showMessage(error.message, true));
        initMinecraftEditor();
        window.setTimeout(() => minecraftEditor?.refresh(), 0);
    }
    if (view === 'console') document.getElementById('mc-console-input').focus();
}

function buildMinecraftBreadcrumb() {
    const container = document.getElementById('mc-breadcrumb');
    const parts = fileDirectory ? fileDirectory.split('/') : [];
    const crumbs = [{ name: 'Server', path: '' }];
    let assembled = '';
    for (const part of parts) {
        assembled = assembled ? `${assembled}/${part}` : part;
        crumbs.push({ name: part, path: assembled });
    }
    container.innerHTML = crumbs.map((crumb) => `<button class="repo-crumb" type="button" data-mc-directory="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</button>`).join('<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>');
}

async function loadMinecraftFiles(directory = fileDirectory) {
    fileDirectory = directory;
    buildMinecraftBreadcrumb();
    const query = new URLSearchParams({ path: directory });
    const response = await apiRequest(`/api/minecraft/files?${query}`);
    const entries = (await response.json()).entries;
    const tree = document.getElementById('mc-file-tree');
    tree.innerHTML = entries.length ? entries.map((entry) => `<button class="repo-tree-entry ${entry.path === openedMinecraftFile ? 'active' : ''}" type="button" data-mc-path="${escapeHtml(entry.path)}" data-mc-folder="${entry.isFolder}"><span class="material-symbols-outlined" aria-hidden="true">${entry.isFolder ? 'folder' : ['properties', 'yml', 'yaml', 'txt', 'json', 'log'].includes(entry.name.split('.').pop().toLowerCase()) ? 'description' : 'code'}</span><span>${escapeHtml(entry.name)}</span></button>`).join('') : '<p class="repo-tree-empty">This folder is empty.</p>';
}

function minecraftMime(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    const map = { properties: 'text/properties', yml: 'yaml', yaml: 'yaml', json: 'application/json', xml: 'application/xml', html: 'text/html', md: 'markdown', txt: 'text/plain', log: 'text/plain', sh: 'shell', cfg: 'text/plain', conf: 'text/plain' };
    return map[extension] || 'text/plain';
}

async function openMinecraftFile(filePath) {
    const query = new URLSearchParams({ path: filePath });
    const response = await apiRequest(`/api/minecraft/file?${query}`);
    const data = await response.json();
    initMinecraftEditor();
    openedMinecraftFile = filePath;
    originalMinecraftContent = data.content;
    document.getElementById('mc-open-file').textContent = filePath;
    document.getElementById('mc-delete-file').hidden = false;
    document.getElementById('mc-save-file').disabled = true;
    if (minecraftEditor) {
        minecraftEditor.setValue(data.content);
        minecraftEditor.clearHistory();
        minecraftEditor.setOption('mode', minecraftMime(filePath));
        window.setTimeout(() => minecraftEditor.refresh(), 0);
    } else minecraftEditorTextarea.value = data.content;
    await loadMinecraftFiles(fileDirectory);
}

async function saveMinecraftFile() {
    if (!openedMinecraftFile) return;
    const content = minecraftEditor ? minecraftEditor.getValue() : minecraftEditorTextarea.value;
    const query = new URLSearchParams({ path: openedMinecraftFile });
    try {
        await apiRequest(`/api/minecraft/file?${query}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content });
        originalMinecraftContent = content;
        document.getElementById('mc-save-file').disabled = true;
        showMessage('Server file saved.');
    } catch (error) { showMessage(error.message, true); }
}

async function deleteMinecraftFile() {
    if (!openedMinecraftFile || !window.confirm(`Delete ${openedMinecraftFile}?`)) return;
    const query = new URLSearchParams({ path: openedMinecraftFile });
    try {
        await apiRequest(`/api/minecraft/file?${query}`, { method: 'DELETE' });
        openedMinecraftFile = '';
        originalMinecraftContent = '';
        if (minecraftEditor) minecraftEditor.setValue('');
        document.getElementById('mc-open-file').textContent = 'Select a text file';
        document.getElementById('mc-delete-file').hidden = true;
        document.getElementById('mc-save-file').disabled = true;
        await loadMinecraftFiles(fileDirectory);
        showMessage('Server file deleted.');
    } catch (error) { showMessage(error.message, true); }
}

async function sendMinecraftCommand(event) {
    event.preventDefault();
    const input = document.getElementById('mc-console-input');
    const command = input.value.trim();
    if (!command) return;
    try {
        await apiRequest('/api/minecraft/console', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
        input.value = '';
        await loadMinecraftStatus();
    } catch (error) { showMessage(error.message, true); }
}

function bindMinecraftUi() {
    document.getElementById('mc-create-submit').lastChild.textContent = 'Create server';
    createDialog.querySelector('.dialog-hint').textContent = 'Java is installed separately from Runtime setup after the server files are imported.';
    document.getElementById('runtime-version-label').textContent = `Java ${configuredJavaVersion}`;
    document.getElementById('open-minecraft-create').addEventListener('click', () => createDialog.showModal());
    document.getElementById('mc-jar-file').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            document.getElementById('mc-jar-file-label').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
            const jarPath = document.getElementById('mc-jar-name');
            if (jarPath.value === 'server.jar' && file.name !== 'server.jar') jarPath.value = file.name;
        }
    });
    document.getElementById('mc-folder-files').addEventListener('change', (event) => {
        const files = [...event.target.files];
        document.getElementById('mc-folder-file-label').textContent = `${files.length} files selected`;
        const jar = files.find((file) => file.name.toLowerCase().endsWith('.jar'));
        if (jar) document.getElementById('mc-jar-name').value = jar.webkitRelativePath.split('/').slice(1).join('/') || jar.name;
    });
    document.querySelectorAll('input[name="mc-source"]').forEach((radio) => radio.addEventListener('change', () => {
        const folderMode = document.querySelector('input[name="mc-source"]:checked').value === 'folder';
        document.getElementById('mc-folder-pick').hidden = !folderMode;
        document.getElementById('mc-jar-pick').hidden = folderMode;
        jarInput.required = !folderMode;
        folderInput.required = folderMode;
    }));
    document.getElementById('minecraft-create-form').addEventListener('submit', createMinecraftServer);
    document.querySelectorAll('[data-close-mc-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
    document.getElementById('install-runtime').addEventListener('click', installJava);
    document.getElementById('start-minecraft').addEventListener('click', startMinecraft);
    document.getElementById('stop-minecraft').addEventListener('click', stopMinecraft);
    document.getElementById('delete-minecraft').addEventListener('click', deleteMinecraft);
    document.getElementById('rename-minecraft').addEventListener('click', () => {
        document.getElementById('mc-rename-input').value = minecraftState?.name || '';
        renameDialog.showModal();
    });
    document.getElementById('minecraft-rename-form').addEventListener('submit', renameMinecraft);
    document.querySelectorAll('.minecraft-tab').forEach((tab) => tab.addEventListener('click', () => switchMinecraftTab(tab.dataset.mcView)));
    document.getElementById('refresh-minecraft').addEventListener('click', loadMinecraftStatus);
    document.getElementById('refresh-mc-files').addEventListener('click', () => loadMinecraftFiles(fileDirectory));
    document.getElementById('mc-file-tree').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-mc-path]');
        if (!button) return;
        try {
            if (button.dataset.mcFolder === 'true') await loadMinecraftFiles(button.dataset.mcPath);
            else await openMinecraftFile(button.dataset.mcPath);
        } catch (error) { showMessage(error.message, true); }
    });
    document.getElementById('mc-breadcrumb').addEventListener('click', (event) => {
        const button = event.target.closest('[data-mc-directory]');
        if (button) loadMinecraftFiles(button.dataset.mcDirectory).catch((error) => showMessage(error.message, true));
    });
    document.getElementById('mc-save-file').addEventListener('click', saveMinecraftFile);
    document.getElementById('mc-delete-file').addEventListener('click', deleteMinecraftFile);
    document.getElementById('mc-editor').addEventListener('input', () => {
        const content = minecraftEditor ? minecraftEditor.getValue() : minecraftEditorTextarea.value;
        document.getElementById('mc-save-file').disabled = !openedMinecraftFile || content === originalMinecraftContent;
    });
    document.getElementById('mc-console-form').addEventListener('submit', sendMinecraftCommand);
    document.getElementById('clear-mc-console').addEventListener('click', () => {
        consoleLength = minecraftState?.logs?.length || 0;
        document.getElementById('mc-console-output').replaceChildren();
    });
    document.getElementById('download-server-folder').addEventListener('click', () => showMessage('Use the Storage page to download individual server files. Full-folder export is not available yet.'));
}

bindMinecraftUi();
loadMinecraftStatus();
refreshTimer = window.setInterval(loadMinecraftStatus, 2000);
window.addEventListener('beforeunload', () => window.clearInterval(refreshTimer));
