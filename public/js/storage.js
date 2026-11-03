const filesView = document.getElementById('files-view');
const searchInput = document.getElementById('search-input');
const statusMessage = document.getElementById('status-message');
const itemDialog = document.getElementById('item-dialog');
const itemForm = document.getElementById('item-form');
const itemNameInput = document.getElementById('item-name');
const contentTextarea = document.getElementById('item-content');
const editorSurface = document.getElementById('editor-surface');
const editorTools = document.getElementById('editor-tools');
const languageSelect = document.getElementById('language-select');
const markdownPreview = document.getElementById('markdown-preview');
const markdownPreviewToggle = document.getElementById('markdown-preview-toggle');
const moveDialog = document.getElementById('move-dialog');
const moveForm = document.getElementById('move-form');
const previewDialog = document.getElementById('preview-dialog');
const selectedPaths = new Set();
const isMinecraftScope = new URLSearchParams(location.search).get('scope') === 'minecraft';
const favorites = new Set(JSON.parse(localStorage.getItem('home-drive-favorites') || '[]'));
let currentPath = '';
let currentFilter = 'all';
let currentEntries = [];
let allEntries = [];
let sortBy = 'name';
let sortDirection = 'asc';
let viewMode = 'list';
let dialogMode = 'folder';
let dialogItem = null;
let moveItems = [];
let statusTimer;

if (isMinecraftScope) {
    document.title = 'Minecraft Files | Home Server';
    document.querySelector('.drive-title-wrap h1').textContent = 'Minecraft Files';
    document.querySelector('.drive-welcome h2').textContent = 'Managed server files.';
    document.querySelector('.drive-welcome .eyebrow').textContent = 'MINECRAFT SERVER';
    document.getElementById('storage-path-label').textContent = 'Managed Minecraft server';
    document.querySelectorAll('.drive-tab[data-filter="starred"], .drive-tab[data-filter="recent"]').forEach((tab) => { tab.hidden = true; });
    document.querySelector('.view-switch').hidden = true;
    document.getElementById('sort-select').disabled = true;
    searchInput.placeholder = 'Search this folder';
    document.querySelector('.drive-actions').insertAdjacentHTML('afterbegin', '<a class="drive-button" href="/minecraft.html"><span class="material-symbols-outlined" aria-hidden="true">arrow_back</span><span>Server manager</span></a>');
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const apiPath = (endpoint, path = '') => {
    const query = new URLSearchParams();
    if (path) query.set('path', path);
    return `${endpoint}${query.size ? `?${query}` : ''}`;
};

const listFilesUrl = (path = '') => apiPath(isMinecraftScope ? '/api/minecraft/files' : '/api/files', path);
const fileContentUrl = (path) => apiPath(isMinecraftScope ? '/api/minecraft/file' : '/api/files/content', path);
const fileDownloadUrl = (path) => apiPath(isMinecraftScope ? '/api/minecraft/download' : '/api/files/download', path);
const filePreviewUrl = (path) => apiPath(isMinecraftScope ? '/api/minecraft/preview' : '/api/files/preview', path);
const fileDeleteUrl = (path) => apiPath(isMinecraftScope ? '/api/minecraft/file' : '/api/files', path);

function currentEditorContent() {
    return codeEditor ? codeEditor.getValue() : contentTextarea.value;
}

function setEditorContent(value) {
    contentTextarea.value = value;
    if (codeEditor) codeEditor.setValue(value);
}

function loadEditorMode(modeName) {
    if (!modeName || !window.CodeMirror || CodeMirror.modes[modeName]) return Promise.resolve();
    if (!loadedModes.has(modeName)) {
        const modeScript = document.createElement('script');
        loadedModes.set(modeName, new Promise((resolve, reject) => {
            modeScript.src = `https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/${modeName}/${modeName}.min.js`;
            modeScript.onload = resolve;
            modeScript.onerror = () => reject(new Error(`Could not load ${modeName} highlighting`));
            document.head.append(modeScript);
        }));
    }
    return loadedModes.get(modeName);
}

async function setEditorLanguage(selection = 'auto') {
    if (!codeEditor) return;
    let language = selection;
    if (selection === 'auto') {
        const extension = itemNameInput.value.split('.').pop().toLowerCase();
        language = extensionLanguages[extension] || 'text';
    }
    const definition = modeDefinitions[language] || modeDefinitions.text;
    const generation = ++modeGeneration;
    try {
        await loadEditorMode(definition.mode);
        if (generation === modeGeneration) codeEditor.setOption('mode', definition.mime);
    } catch (error) {
        if (generation === modeGeneration) {
            codeEditor.setOption('mode', 'text/plain');
            showStatus(`${error.message}; plain text editing is still available`, true);
        }
    }
}

function updateMarkdownPreviewButton() {
    const extension = itemNameInput.value.split('.').pop().toLowerCase();
    markdownPreviewToggle.hidden = !(['md', 'markdown'].includes(extension) || languageSelect.value === 'markdown');
}

function renderMarkdown(container, source) {
    if (window.marked?.parse && window.DOMPurify?.sanitize) {
        container.innerHTML = DOMPurify.sanitize(marked.parse(source));
    } else {
        const pre = document.createElement('pre');
        pre.textContent = source;
        container.replaceChildren(pre);
    }
}

function toggleMarkdownEditorPreview() {
    markdownPreviewOpen = !markdownPreviewOpen;
    editorSurface.hidden = markdownPreviewOpen;
    markdownPreview.hidden = !markdownPreviewOpen;
    markdownPreviewToggle.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${markdownPreviewOpen ? 'edit' : 'visibility'}</span>${markdownPreviewOpen ? 'Edit Markdown' : 'Preview Markdown'}`;
    if (markdownPreviewOpen) renderMarkdown(markdownPreview, currentEditorContent());
    else window.setTimeout(() => codeEditor?.refresh(), 0);
}

const editableExtensions = ['txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'pyw', 'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'cs', 'kt', 'kts', 'swift', 'dart', 'lua', 'pl', 'r', 'ps1', 'toml', 'css', 'html', 'htm', 'xml', 'csv', 'log', 'yaml', 'yml', 'sh', 'bash', 'sql', 'go', 'rs', 'php', 'rb'];
const modeDefinitions = {
    text: { mode: '', mime: 'text/plain' }, python: { mode: 'python', mime: 'python' },
    java: { mode: 'clike', mime: 'text/x-java' }, c: { mode: 'clike', mime: 'text/x-csrc' },
    cpp: { mode: 'clike', mime: 'text/x-c++src' }, javascript: { mode: 'javascript', mime: 'javascript' },
    typescript: { mode: 'javascript', mime: 'text/typescript' }, html: { mode: 'xml', mime: 'text/html' },
    css: { mode: 'css', mime: 'css' }, json: { mode: 'javascript', mime: 'application/json' },
    markdown: { mode: 'markdown', mime: 'markdown' }, yaml: { mode: 'yaml', mime: 'yaml' },
    shell: { mode: 'shell', mime: 'shell' }, sql: { mode: 'sql', mime: 'text/x-sql' },
    go: { mode: 'go', mime: 'text/x-go' }, rust: { mode: 'rust', mime: 'text/x-rustsrc' },
    php: { mode: 'php', mime: 'application/x-httpd-php' }, ruby: { mode: 'ruby', mime: 'text/x-ruby' },
    csharp: { mode: 'clike', mime: 'text/x-csharp' }, kotlin: { mode: 'clike', mime: 'text/x-kotlin' },
    swift: { mode: 'swift', mime: 'text/x-swift' }, dart: { mode: 'dart', mime: 'text/x-dart' },
    lua: { mode: 'lua', mime: 'text/x-lua' }, perl: { mode: 'perl', mime: 'text/x-perl' },
    r: { mode: 'r', mime: 'text/x-rsrc' }, powershell: { mode: 'powershell', mime: 'application/x-powershell' },
    toml: { mode: 'toml', mime: 'text/x-toml' }
};
const extensionLanguages = {
    txt: 'text', md: 'markdown', markdown: 'markdown', json: 'json', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', pyw: 'python', java: 'java', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
    css: 'css', html: 'html', htm: 'html', xml: 'html', csv: 'text', log: 'text', yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
    cs: 'csharp', kt: 'kotlin', kts: 'kotlin', swift: 'swift', dart: 'dart', lua: 'lua', pl: 'perl', r: 'r', ps1: 'powershell', toml: 'toml'
};
const loadedModes = new Map();
const codeEditor = window.CodeMirror ? CodeMirror.fromTextArea(contentTextarea, {
    theme: 'material-darker', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true,
    indentUnit: 4, tabSize: 4, lineWrapping: false, autofocus: false,
    extraKeys: { 'Ctrl-S': () => itemForm.requestSubmit(), 'Cmd-S': () => itemForm.requestSubmit(), 'Ctrl-F': 'findPersistent' }
}) : null;
let modeGeneration = 0;
let markdownPreviewOpen = false;

async function apiRequest(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
    }
    return response;
}

function showStatus(message, isError = false) {
    window.clearTimeout(statusTimer);
    statusMessage.textContent = message;
    statusMessage.classList.toggle('error', isError);
    if (message) statusTimer = window.setTimeout(() => { statusMessage.textContent = ''; }, 5000);
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function fileIcon(entry) {
    if (entry.isFolder) return 'folder';
    if (editableExtensions.includes(entry.extension)) return 'code';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(entry.extension)) return 'image';
    if (['mp4', 'mov', 'mkv', 'webm'].includes(entry.extension)) return 'movie';
    if (['mp3', 'wav', 'flac', 'ogg'].includes(entry.extension)) return 'audio_file';
    if (entry.extension === 'pdf') return 'picture_as_pdf';
    if (['zip', 'gz', '7z', 'tar'].includes(entry.extension)) return 'folder_zip';
    if (['txt', 'md', 'json', 'js', 'css', 'html', 'xml', 'csv', 'log'].includes(entry.extension)) return 'description';
    return 'draft';
}

function buildBreadcrumbs() {
    const breadcrumbs = document.getElementById('breadcrumbs');
    if (isMinecraftScope && currentFilter === 'all' && !searchInput.value.trim()) {
        const parts = currentPath ? currentPath.split('/') : [];
        const crumbs = [{ label: 'Minecraft server', path: '' }];
        let assembled = '';
        for (const part of parts) {
            assembled = assembled ? `${assembled}/${part}` : part;
            crumbs.push({ label: part, path: assembled });
        }
        breadcrumbs.innerHTML = crumbs.map((crumb, index) => `${index ? '<span class="material-symbols-outlined breadcrumb-separator" aria-hidden="true">chevron_right</span>' : ''}<button class="breadcrumb-button" type="button" data-path="${escapeHtml(crumb.path)}">${escapeHtml(crumb.label)}</button>`).join('');
        return;
    }
    if (currentFilter !== 'all' || searchInput.value.trim()) {
        breadcrumbs.innerHTML = `<button class="breadcrumb-button" type="button" data-path="">${currentFilter === 'starred' ? 'Starred' : currentFilter === 'recent' ? 'Recent' : 'Search results'}</button>`;
        return;
    }
    const parts = currentPath ? currentPath.split('/') : [];
    const crumbs = [{ label: 'My Drive', path: '' }];
    let assembled = '';
    for (const part of parts) {
        assembled = assembled ? `${assembled}/${part}` : part;
        crumbs.push({ label: part, path: assembled });
    }
    breadcrumbs.innerHTML = crumbs.map((crumb, index) => `${index ? '<span class="material-symbols-outlined breadcrumb-separator" aria-hidden="true">chevron_right</span>' : ''}<button class="breadcrumb-button" type="button" data-path="${escapeHtml(crumb.path)}" ${index === crumbs.length - 1 ? 'aria-current="page"' : ''}>${escapeHtml(crumb.label)}</button>`).join('');
}

function sortEntries(entries) {
    const compare = {
        name: (left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
        modified: (left, right) => left.modified.localeCompare(right.modified),
        size: (left, right) => left.size - right.size,
        type: (left, right) => left.extension.localeCompare(right.extension) || left.name.localeCompare(right.name)
    }[sortBy];
    return [...entries].sort((left, right) => (Number(right.isFolder) - Number(left.isFolder)) || (sortDirection === 'asc' ? 1 : -1) * compare(left, right));
}

function renderEntries() {
    let visibleEntries;
    const searchTerm = searchInput.value.trim().toLocaleLowerCase();
    if (currentFilter !== 'all' || searchTerm) {
        visibleEntries = allEntries;
        if (currentFilter === 'starred') visibleEntries = visibleEntries.filter((entry) => favorites.has(entry.path));
        if (currentFilter === 'recent') visibleEntries = [...visibleEntries].sort((left, right) => right.modified.localeCompare(left.modified)).slice(0, 50);
        if (searchTerm) visibleEntries = visibleEntries.filter((entry) => `${entry.name} ${entry.path}`.toLocaleLowerCase().includes(searchTerm));
        visibleEntries = sortEntries(visibleEntries);
    } else {
        visibleEntries = sortEntries(currentEntries);
    }

    document.getElementById('loading-state').hidden = true;
    document.getElementById('empty-state').hidden = visibleEntries.length > 0;
    document.getElementById('item-count').textContent = currentFilter === 'all' && !searchTerm
        ? `${currentEntries.length} item${currentEntries.length === 1 ? '' : 's'} in this folder`
        : `${visibleEntries.length} result${visibleEntries.length === 1 ? '' : 's'}`;
    document.getElementById('storage-path-label').textContent = currentPath || (isMinecraftScope ? 'Managed Minecraft server' : 'Stored on this server');
    document.getElementById('selection-count').textContent = selectedPaths.size ? `${selectedPaths.size} selected` : '';
    document.getElementById('delete-selected-button').hidden = selectedPaths.size === 0;
    document.getElementById('move-selected-button').hidden = isMinecraftScope || selectedPaths.size === 0;
    document.getElementById('download-selected-button').hidden = selectedPaths.size === 0;
    buildBreadcrumbs();

    const header = '<div class="file-list-header"><span></span><span>Name</span><span class="modified-meta">Modified</span><span>Size</span><span></span></div>';
    const rows = visibleEntries.map((entry) => {
        const pathValue = escapeHtml(entry.path);
        const starred = favorites.has(entry.path);
        const location = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : 'My Drive';
        return `<div class="file-row ${selectedPaths.has(entry.path) ? 'selected' : ''}" data-item-path="${pathValue}">
            <input class="file-check" type="checkbox" aria-label="Select ${escapeHtml(entry.name)}" data-select-path="${pathValue}" ${selectedPaths.has(entry.path) ? 'checked' : ''}>
            <div class="file-name-cell"><span class="file-icon ${entry.isFolder ? 'folder-icon' : ''}"><span class="material-symbols-outlined" aria-hidden="true">${fileIcon(entry)}</span></span><button class="file-name-button" type="button" data-action="open">${escapeHtml(entry.name)}</button></div>
            <span class="file-meta modified-meta">${formatDate(entry.modified)}${currentFilter !== 'all' || searchTerm ? ` · ${escapeHtml(location)}` : ''}</span>
            <span class="file-meta size-meta">${entry.isFolder ? 'Folder' : formatBytes(entry.size)}</span>
            <div class="file-actions">${isMinecraftScope ? '' : `<button class="icon-button star-button" type="button" data-action="star" aria-label="${starred ? 'Remove from starred' : 'Add to starred'}" aria-pressed="${starred}" title="${starred ? 'Remove from starred' : 'Add to starred'}"><span class="material-symbols-outlined" aria-hidden="true">${starred ? 'star' : 'star_outline'}</span></button>`}
                <details class="file-menu"><summary class="icon-button" aria-label="More actions" title="More actions"><span class="material-symbols-outlined" aria-hidden="true">more_vert</span></summary><div class="file-menu-items">
                    ${entry.isFolder ? '' : `<button type="button" data-action="preview"><span class="material-symbols-outlined">visibility</span>Preview</button>${editableExtensions.includes(entry.extension) ? '<button type="button" data-action="edit"><span class="material-symbols-outlined">edit</span>Edit file</button>' : ''}<button type="button" data-action="download"><span class="material-symbols-outlined">download</span>Download</button>`}
                    ${isMinecraftScope ? '' : '<button type="button" data-action="duplicate"><span class="material-symbols-outlined">content_copy</span>Make a copy</button><button type="button" data-action="rename"><span class="material-symbols-outlined">drive_file_rename_outline</span>Rename</button><button type="button" data-action="move"><span class="material-symbols-outlined">drive_file_move</span>Move</button>'}
                    <button type="button" data-action="copy"><span class="material-symbols-outlined">link</span>Copy path</button>
                    <button type="button" class="danger-action" data-action="delete"><span class="material-symbols-outlined">delete</span>Delete</button>
                </div></details></div>
            <span class="file-meta mobile-modified">${formatDate(entry.modified)}</span>
        </div>`;
    }).join('');
    filesView.classList.toggle('grid-mode', viewMode === 'grid');
    filesView.innerHTML = header + rows;
}

async function loadFiles() {
    document.getElementById('loading-state').hidden = false;
    document.getElementById('empty-state').hidden = true;
    try {
        const params = new URLSearchParams({ sort: sortBy, direction: sortDirection });
        const directoryResponse = await apiRequest(listFilesUrl(currentPath));
        currentEntries = (await directoryResponse.json()).entries.map((entry) => ({
            ...entry,
            extension: entry.extension || (entry.isFolder ? '' : entry.name.split('.').pop().toLowerCase())
        }));
        if (isMinecraftScope) allEntries = currentEntries;
        else {
            const allResponse = await apiRequest(`/api/files/all?${params}`);
            allEntries = (await allResponse.json()).entries;
        }
        selectedPaths.clear();
        renderEntries();
        showStatus('');
    } catch (error) {
        document.getElementById('loading-state').hidden = true;
        document.getElementById('empty-state').hidden = true;
        filesView.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">cloud_off</span><h3>Storage is unavailable</h3><p>${escapeHtml(error.message)}. Start the Node server and reload this page.</p></div>`;
        showStatus(error.message, true);
    }
}

function openItemDialog(mode, item = null) {
    dialogMode = mode;
    dialogItem = item;
    const isText = mode === 'new-file' || mode === 'edit';
    const title = { folder: 'New folder', 'new-file': 'New text file', rename: 'Rename item', edit: 'Edit text file' }[mode];
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('save-item-button').textContent = mode === 'edit' ? 'Save changes' : mode === 'rename' ? 'Rename' : 'Create';
    itemNameInput.value = item?.name || '';
    itemNameInput.disabled = mode === 'edit';
    document.getElementById('content-label').hidden = !isText;
    editorTools.hidden = !isText;
    editorSurface.hidden = !isText;
    markdownPreview.hidden = true;
    markdownPreview.replaceChildren();
    markdownPreviewOpen = false;
    languageSelect.value = 'auto';
    setEditorContent('');
    updateMarkdownPreviewButton();
    itemDialog.showModal();
    if (isText) {
        setEditorLanguage('auto');
        window.setTimeout(() => codeEditor?.refresh(), 0);
    }
    if (mode === 'edit') loadTextIntoEditor(item.path);
    else itemNameInput.focus();
}

async function loadTextIntoEditor(filePath) {
    try {
        const response = await apiRequest(fileContentUrl(filePath));
        const data = await response.json();
        setEditorContent(data.content);
    } catch (error) {
        itemDialog.close();
        showStatus(error.message, true);
    }
}

async function saveItem(event) {
    event.preventDefault();
    const name = itemNameInput.value.trim();
    const content = currentEditorContent();
    try {
        if (dialogMode === 'folder') {
            await apiRequest(isMinecraftScope ? '/api/minecraft/folder' : '/api/files/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPath, name }) });
        } else if (dialogMode === 'new-file') {
            if (isMinecraftScope) {
                const filePath = currentPath ? `${currentPath}/${name}` : name;
                await apiRequest(fileContentUrl(filePath), { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content });
            } else {
                await apiRequest('/api/files/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentPath, name, content }) });
            }
        } else if (dialogMode === 'rename') {
            await apiRequest('/api/files/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dialogItem.path, name }) });
        } else if (dialogMode === 'edit') {
            await apiRequest(fileContentUrl(dialogItem.path), { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content });
        }
        itemDialog.close();
        await loadFiles();
        showStatus(dialogMode === 'edit' ? 'Changes saved' : 'Item created');
    } catch (error) {
        showStatus(error.message, true);
    }
}

function closeOpenMenus() {
    document.querySelectorAll('.file-menu[open]').forEach((menu) => menu.removeAttribute('open'));
}

async function downloadFile(filePath) {
    const response = await apiRequest(fileDownloadUrl(filePath));
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filePath.split('/').pop();
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function previewFile(entry) {
    document.getElementById('preview-title').textContent = entry.name;
    const preview = document.getElementById('preview-content');
    const editButton = document.getElementById('preview-edit-button');
    preview.classList.remove('markdown-body');
    editButton.hidden = !editableExtensions.includes(entry.extension);
    document.getElementById('preview-download-button').onclick = () => downloadFile(entry.path);
    editButton.onclick = () => { previewDialog.close(); openItemDialog('edit', entry); };
    preview.replaceChildren();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(entry.extension)) {
        const image = document.createElement('img');
        const response = await apiRequest(fileDownloadUrl(entry.path));
        const imageUrl = URL.createObjectURL(await response.blob());
        image.src = imageUrl;
        previewDialog.addEventListener('close', () => URL.revokeObjectURL(imageUrl), { once: true });
        image.alt = entry.name;
        preview.append(image);
    } else if (entry.extension === 'pdf') {
        const frame = document.createElement('iframe');
        frame.title = `Preview of ${entry.name}`;
        frame.src = filePreviewUrl(entry.path);
        preview.append(frame);
    } else if (['md', 'markdown'].includes(entry.extension) && entry.size <= 2 * 1024 * 1024) {
        try {
            const response = await apiRequest(fileContentUrl(entry.path));
            const data = await response.json();
            preview.classList.add('markdown-body');
            renderMarkdown(preview, data.content);
        } catch (error) {
            preview.textContent = error.message;
        }
    } else if (editableExtensions.includes(entry.extension) && entry.size <= 2 * 1024 * 1024) {
        try {
            const response = await apiRequest(fileContentUrl(entry.path));
            const data = await response.json();
            const pre = document.createElement('pre');
            pre.textContent = data.content;
            preview.append(pre);
        } catch (error) {
            preview.textContent = error.message;
        }
    } else {
        const message = document.createElement('p');
        message.textContent = entry.size > 2 * 1024 * 1024 ? 'This file is too large to preview here.' : 'No preview is available for this file type.';
        preview.append(message);
    }
    previewDialog.showModal();
}

function openItem(entry) {
    if (entry.isFolder) {
        currentPath = entry.path;
        currentFilter = 'all';
        document.querySelectorAll('.drive-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.filter === 'all'));
        loadFiles();
    } else {
        previewFile(entry);
    }
}

function setFavorite(filePath) {
    if (favorites.has(filePath)) favorites.delete(filePath);
    else favorites.add(filePath);
    localStorage.setItem('home-drive-favorites', JSON.stringify([...favorites]));
    renderEntries();
}

function selectedEntries() {
    return allEntries.filter((entry) => selectedPaths.has(entry.path));
}

async function moveSelected() {
    moveItems = selectedEntries();
    if (!moveItems.length) return;
    document.getElementById('destination-path').value = '';
    moveDialog.showModal();
}

async function moveItemsTo(destinationPath) {
    for (const entry of moveItems) {
        await apiRequest('/api/files/move', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: entry.path, targetPath: destinationPath })
        });
    }
    moveDialog.close();
    await loadFiles();
    showStatus(`${moveItems.length} item${moveItems.length === 1 ? '' : 's'} moved`);
}

async function uploadFiles(fileList) {
    const files = [...fileList];
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        showStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        if (isMinecraftScope) {
            const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            await apiRequest(`/api/minecraft/upload?${new URLSearchParams({ path: filePath })}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        } else {
            const query = new URLSearchParams({ name: file.name });
            if (currentPath) query.set('path', currentPath);
            await apiRequest(`/api/files/upload?${query}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        }
    }
    await loadFiles();
    showStatus(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`);
}

filesView.addEventListener('click', async (event) => {
    const menuSummary = event.target.closest('.file-menu > summary');
    if (menuSummary) {
        const menu = menuSummary.closest('.file-menu');
        requestAnimationFrame(() => {
            if (!menu.open) {
                menu.classList.remove('opens-up');
                return;
            }
            const menuItems = menu.querySelector('.file-menu-items');
            const summaryBounds = menuSummary.getBoundingClientRect();
            const menuHeight = Math.min(menuItems.scrollHeight, window.innerHeight * 0.6);
            const roomBelow = window.innerHeight - summaryBounds.bottom;
            menu.classList.toggle('opens-up', roomBelow < menuHeight && summaryBounds.top > menuHeight);
        });
        return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-item-path]');
    const entry = allEntries.find((item) => item.path === row.dataset.itemPath) || currentEntries.find((item) => item.path === row.dataset.itemPath);
    if (!entry) return;
    const action = button.dataset.action;
    if (action !== 'star') closeOpenMenus();
    try {
        if (action === 'open') openItem(entry);
        if (action === 'star') setFavorite(entry.path);
        if (action === 'preview') await previewFile(entry);
        if (action === 'edit') openItemDialog('edit', entry);
        if (action === 'download') await downloadFile(entry.path);
        if (action === 'rename') openItemDialog('rename', entry);
        if (action === 'duplicate') {
            await apiRequest('/api/files/duplicate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: entry.path }) });
            await loadFiles();
            showStatus('Copy created');
        }
        if (action === 'move') { moveItems = [entry]; document.getElementById('destination-path').value = ''; moveDialog.showModal(); }
        if (action === 'copy') {
            await navigator.clipboard.writeText(entry.path);
            showStatus(`Copied path: ${entry.path}`);
        }
        if (action === 'delete' && window.confirm(`Delete “${entry.name}”${entry.isFolder ? ' and everything inside it' : ''}?`)) {
            await apiRequest(fileDeleteUrl(entry.path), { method: 'DELETE' });
            selectedPaths.delete(entry.path);
            await loadFiles();
            showStatus('Item deleted');
        }
    } catch (error) { showStatus(error.message, true); }
});

filesView.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-select-path]');
    if (!checkbox) return;
    if (checkbox.checked) selectedPaths.add(checkbox.dataset.selectPath);
    else selectedPaths.delete(checkbox.dataset.selectPath);
    renderEntries();
});

document.getElementById('breadcrumbs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-path]');
    if (!button || currentFilter !== 'all' || searchInput.value.trim()) return;
    currentPath = button.dataset.path;
    selectedPaths.clear();
    loadFiles();
});

document.querySelectorAll('.drive-tab').forEach((tab) => tab.addEventListener('click', () => {
    currentFilter = tab.dataset.filter;
    selectedPaths.clear();
    document.querySelectorAll('.drive-tab').forEach((item) => item.classList.toggle('active', item === tab));
    renderEntries();
}));

document.getElementById('new-folder-button').addEventListener('click', () => openItemDialog('folder'));
document.getElementById('new-file-button').addEventListener('click', () => openItemDialog('new-file'));
document.getElementById('upload-button').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', async (event) => {
    try { await uploadFiles(event.target.files); }
    catch (error) { showStatus(error.message, true); }
    event.target.value = '';
});
itemForm.addEventListener('submit', saveItem);
languageSelect.addEventListener('change', () => {
    setEditorLanguage(languageSelect.value);
    updateMarkdownPreviewButton();
});
itemNameInput.addEventListener('input', () => {
    updateMarkdownPreviewButton();
    if (languageSelect.value === 'auto') setEditorLanguage('auto');
});
markdownPreviewToggle.addEventListener('click', toggleMarkdownEditorPreview);
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

document.getElementById('sort-select').addEventListener('change', (event) => { sortBy = event.target.value; loadFiles(); });
document.getElementById('sort-direction-button').addEventListener('click', (event) => {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    const icon = event.currentTarget.querySelector('.material-symbols-outlined');
    icon.textContent = sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';
    loadFiles();
});
document.getElementById('list-view-button').addEventListener('click', () => {
    viewMode = 'list';
    document.getElementById('list-view-button').classList.add('active');
    document.getElementById('grid-view-button').classList.remove('active');
    renderEntries();
});
document.getElementById('grid-view-button').addEventListener('click', () => {
    viewMode = 'grid';
    document.getElementById('grid-view-button').classList.add('active');
    document.getElementById('list-view-button').classList.remove('active');
    renderEntries();
});
document.getElementById('select-all-button').addEventListener('click', () => {
    let visibleEntries = currentFilter === 'all' && !searchInput.value.trim() ? currentEntries : allEntries;
    if (currentFilter === 'starred') visibleEntries = visibleEntries.filter((entry) => favorites.has(entry.path));
    if (currentFilter === 'recent') visibleEntries = [...visibleEntries].sort((left, right) => right.modified.localeCompare(left.modified)).slice(0, 50);
    if (searchInput.value.trim()) visibleEntries = visibleEntries.filter((entry) => `${entry.name} ${entry.path}`.toLowerCase().includes(searchInput.value.trim().toLowerCase()));
    const allSelected = visibleEntries.length && visibleEntries.every((entry) => selectedPaths.has(entry.path));
    visibleEntries.forEach((entry) => allSelected ? selectedPaths.delete(entry.path) : selectedPaths.add(entry.path));
    renderEntries();
});
document.getElementById('delete-selected-button').addEventListener('click', async () => {
    const entries = selectedEntries();
    if (!entries.length || !window.confirm(`Permanently delete ${entries.length} selected item${entries.length === 1 ? '' : 's'}?`)) return;
    try {
        for (const entry of entries) await apiRequest(fileDeleteUrl(entry.path), { method: 'DELETE' });
        selectedPaths.clear();
        await loadFiles();
        showStatus(`${entries.length} item${entries.length === 1 ? '' : 's'} deleted`);
    } catch (error) { showStatus(error.message, true); }
});
document.getElementById('move-selected-button').addEventListener('click', moveSelected);
document.getElementById('download-selected-button').addEventListener('click', async () => {
    for (const entry of selectedEntries()) if (!entry.isFolder) await downloadFile(entry.path);
});
moveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await moveItemsTo(document.getElementById('destination-path').value.trim()); }
    catch (error) { showStatus(error.message, true); }
});

searchInput.addEventListener('input', () => {
    selectedPaths.clear();
    renderEntries();
});

const dropZone = document.getElementById('drop-zone');
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
});
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === 'drop' && event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files).catch((error) => showStatus(error.message, true));
    dropZone.classList.remove('dragging');
});

document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        document.getElementById('file-input').click();
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openItemDialog('folder');
    }
    if (event.key === 'Escape') closeOpenMenus();
});

document.getElementById('refresh-files-button').addEventListener('click', loadFiles);
loadFiles();
