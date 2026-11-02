const repoList = document.getElementById('repo-list');
const repoStatusMessage = document.getElementById('repo-status-message');
const repoDialog = document.getElementById('repo-dialog');
const commitDialog = document.getElementById('commit-dialog');
const branchDialog = document.getElementById('branch-dialog');
const releaseDialog = document.getElementById('release-dialog');
const newFileDialog = document.getElementById('new-file-dialog');
const repoEditorTextarea = document.getElementById('repo-code-editor');
const repoEditorWrap = document.getElementById('repo-editor-wrap');
const readmePreview = document.getElementById('readme-preview');
let codeEditor = null;
let activeRepository = null;
let repositories = [];
let repositoryStatus = null;
let currentDirectory = '';
let currentFilePath = '';
let originalContent = '';
let activeView = 'code';
let previewingMarkdown = false;
let statusTimer;
const modeMap = {
    js: ['javascript', 'javascript'], mjs: ['javascript', 'javascript'], cjs: ['javascript', 'javascript'], jsx: ['javascript', 'jsx'], ts: ['javascript', 'text/typescript'], tsx: ['javascript', 'text/typescript'],
    py: ['python', 'python'], java: ['clike', 'text/x-java'], c: ['clike', 'text/x-csrc'], h: ['clike', 'text/x-csrc'], cpp: ['clike', 'text/x-c++src'], cc: ['clike', 'text/x-c++src'], cs: ['clike', 'text/x-csharp'], kt: ['clike', 'text/x-kotlin'],
    go: ['go', 'text/x-go'], rs: ['rust', 'text/x-rustsrc'], rb: ['ruby', 'text/x-ruby'], php: ['php', 'application/x-httpd-php'], sh: ['shell', 'shell'], bash: ['shell', 'shell'], sql: ['sql', 'text/x-sql'], yaml: ['yaml', 'yaml'], yml: ['yaml', 'yaml'],
    json: ['javascript', 'application/json'], html: ['xml', 'text/html'], htm: ['xml', 'text/html'], xml: ['xml', 'application/xml'], css: ['css', 'css'], md: ['markdown', 'markdown'], markdown: ['markdown', 'markdown'], toml: ['toml', 'text/x-toml'], swift: ['swift', 'text/x-swift'], dart: ['dart', 'text/x-dart'], lua: ['lua', 'text/x-lua'], ps1: ['powershell', 'application/x-powershell']
};

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

function showRepoStatus(message, isError = false) {
    window.clearTimeout(statusTimer);
    repoStatusMessage.textContent = message;
    repoStatusMessage.classList.toggle('error', isError);
    if (message) statusTimer = window.setTimeout(() => { repoStatusMessage.textContent = ''; }, 5000);
}

function repoApi(action = '', query = {}) {
    const params = new URLSearchParams(query);
    return `/api/repos${activeRepository ? `/${encodeURIComponent(activeRepository)}` : ''}${action ? `/${action}` : ''}${params.size ? `?${params}` : ''}`;
}

function createEditor() {
    if (codeEditor || !window.CodeMirror) return;
    codeEditor = CodeMirror.fromTextArea(repoEditorTextarea, {
        theme: 'material-darker', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true,
        indentUnit: 4, tabSize: 4, lineWrapping: false,
        extraKeys: { 'Ctrl-S': saveCurrentFile, 'Cmd-S': saveCurrentFile }
    });
    codeEditor.on('change', updateEditorDirtyState);
}

function updateEditorDirtyState() {
    const dirty = Boolean(currentFilePath) && codeEditor && codeEditor.getValue() !== originalContent;
    document.getElementById('file-dirty-indicator').hidden = !dirty;
    document.getElementById('save-file-button').disabled = !currentFilePath || !dirty;
}

function loadModeForFile(filePath) {
    if (!codeEditor) return;
    const extension = filePath.split('.').pop().toLowerCase();
    const [mode, mime] = modeMap[extension] || ['text', 'text/plain'];
    if (window.CodeMirror?.autoLoadMode && mode !== 'text') CodeMirror.autoLoadMode(codeEditor, mode);
    codeEditor.setOption('mode', mime);
}

function updateActiveRepoList() {
    const filter = document.getElementById('repo-search-input').value.trim().toLowerCase();
    const visible = repositories.filter((repo) => repo.name.toLowerCase().includes(filter));
    repoList.innerHTML = visible.map((repo) => `<button class="repo-list-item ${repo.name === activeRepository ? 'active' : ''}" type="button" data-repo-name="${escapeHtml(repo.name)}"><span class="material-symbols-outlined" aria-hidden="true">book</span><span>${escapeHtml(repo.name)}</span></button>`).join('');
    document.getElementById('repo-list-empty').hidden = visible.length > 0;
    document.getElementById('repo-count').textContent = `${repositories.length} repo${repositories.length === 1 ? '' : 's'}`;
}

async function loadRepositories() {
    try {
        const response = await apiRequest('/api/repos');
        repositories = (await response.json()).repositories;
        updateActiveRepoList();
        if (!activeRepository && repositories.length) await selectRepository(repositories[0].name);
        if (activeRepository && !repositories.some((repo) => repo.name === activeRepository)) {
            activeRepository = null;
            document.getElementById('repo-content').hidden = true;
            document.getElementById('repo-welcome').hidden = false;
        }
        showRepoStatus('');
    } catch (error) {
        document.getElementById('repo-count').textContent = 'Offline';
        showRepoStatus(`${error.message}. Repository features require the Node server.`, true);
    }
}

async function selectRepository(name) {
    activeRepository = name;
    currentDirectory = '';
    currentFilePath = '';
    document.getElementById('repo-welcome').hidden = true;
    document.getElementById('repo-content').hidden = false;
    document.getElementById('active-repo-name').textContent = name;
    updateActiveRepoList();
    if (codeEditor) codeEditor.setValue('');
    document.getElementById('open-file-path').textContent = 'Select a file';
    document.getElementById('delete-file-button').hidden = true;
    await Promise.all([loadRepositoryStatus(), loadBranches(), loadTree(''), loadReadme()]);
}

async function loadRepositoryStatus() {
    const response = await apiRequest(repoApi('status'));
    repositoryStatus = await response.json();
    document.getElementById('remote-url').value = repositoryStatus.remote || '';
    const count = repositoryStatus.changedFiles.length;
    document.getElementById('change-count').textContent = count;
    document.getElementById('changes-commit-button').disabled = count === 0;
    renderChanges();
}

async function loadBranches() {
    const response = await apiRequest(repoApi('branches'));
    const data = await response.json();
    const select = document.getElementById('branch-select');
    select.innerHTML = data.branches.map((branch) => `<option value="${escapeHtml(branch)}" ${branch === data.current ? 'selected' : ''}>${escapeHtml(branch)}</option>`).join('');
    if (!data.branches.length) select.innerHTML = '<option value="main">main</option>';
}

function buildRepoBreadcrumb() {
    const container = document.getElementById('repo-breadcrumb');
    const parts = currentDirectory ? currentDirectory.split('/') : [];
    const crumbs = [{ name: activeRepository, path: '' }];
    let assembled = '';
    for (const part of parts) {
        assembled = assembled ? `${assembled}/${part}` : part;
        crumbs.push({ name: part, path: assembled });
    }
    container.innerHTML = crumbs.map((crumb, index) => `${index ? '<span class="material-symbols-outlined" style="font-size:13px;color:#aaa" aria-hidden="true">chevron_right</span>' : ''}<button class="repo-crumb" type="button" data-directory="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</button>`).join('');
}

async function loadTree(directory = currentDirectory) {
    currentDirectory = directory;
    buildRepoBreadcrumb();
    const response = await apiRequest(repoApi('tree', { path: directory }));
    const entries = (await response.json()).entries;
    const tree = document.getElementById('repo-file-tree');
    if (!entries.length) {
        tree.innerHTML = '<p class="repo-tree-empty">No files here yet. Use the new-file button to add one.</p>';
        return;
    }
    tree.innerHTML = entries.map((entry) => `<button class="repo-tree-entry ${entry.path === currentFilePath ? 'active' : ''}" type="button" data-entry-path="${escapeHtml(entry.path)}" data-is-folder="${entry.isFolder}"><span class="material-symbols-outlined" aria-hidden="true">${entry.isFolder ? 'folder' : fileIcon(entry.name)}</span><span>${escapeHtml(entry.name)}</span></button>`).join('');
}

function fileIcon(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(extension)) return 'image';
    if (extension === 'pdf') return 'picture_as_pdf';
    if (['md', 'markdown', 'txt'].includes(extension)) return 'description';
    return 'code';
}

async function openFile(filePath) {
    const response = await apiRequest(repoApi('file', { path: filePath }));
    const data = await response.json();
    createEditor();
    currentFilePath = filePath;
    originalContent = data.content;
    document.getElementById('open-file-path').textContent = filePath;
    document.getElementById('delete-file-button').hidden = false;
    document.getElementById('editor-preview-button').hidden = !['md', 'markdown'].includes(filePath.split('.').pop().toLowerCase());
    if (codeEditor) {
        codeEditor.setValue(data.content);
        codeEditor.clearHistory();
        loadModeForFile(filePath);
        window.setTimeout(() => codeEditor.refresh(), 0);
    } else {
        repoEditorTextarea.value = data.content;
    }
    previewingMarkdown = false;
    repoEditorWrap.hidden = false;
    readmePreview.hidden = true;
    document.getElementById('editor-preview-button').innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">visibility</span>';
    updateEditorDirtyState();
    await loadTree(currentDirectory);
}

function currentEditorContent() {
    return codeEditor ? codeEditor.getValue() : repoEditorTextarea.value;
}

function renderMarkdown(container, source) {
    if (window.marked?.parse && window.DOMPurify?.sanitize) container.innerHTML = DOMPurify.sanitize(marked.parse(source));
    else container.textContent = source;
}

function toggleMarkdownPreview() {
    previewingMarkdown = !previewingMarkdown;
    repoEditorWrap.hidden = previewingMarkdown;
    readmePreview.hidden = !previewingMarkdown;
    document.getElementById('editor-preview-button').innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${previewingMarkdown ? 'edit' : 'visibility'}</span>`;
    if (previewingMarkdown) renderMarkdown(readmePreview, currentEditorContent());
    else window.setTimeout(() => codeEditor?.refresh(), 0);
}

async function saveCurrentFile() {
    if (!activeRepository || !currentFilePath) return;
    const content = currentEditorContent();
    try {
        await apiRequest(repoApi('file', { path: currentFilePath }), { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content });
        originalContent = content;
        updateEditorDirtyState();
        await loadRepositoryStatus();
        showRepoStatus(`Saved ${currentFilePath}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

function renderChanges() {
    const container = document.getElementById('changes-list');
    const changes = repositoryStatus?.changedFiles || [];
    if (!changes.length) {
        container.innerHTML = '<div class="empty-view">Working tree clean. Your files are committed.</div>';
        return;
    }
    container.innerHTML = changes.map((change) => {
        const status = `${change.index}${change.worktree}`;
        const label = status === '??' ? 'Untracked' : status.includes('A') ? 'Added' : status.includes('D') ? 'Deleted' : status.includes('R') ? 'Renamed' : status.includes('M') ? 'Modified' : status;
        return `<div class="change-entry"><span class="change-state">${escapeHtml(status.trim() || '?')}</span><span class="change-file-path">${escapeHtml(change.path)}</span><span class="change-state-label">${label}</span></div>`;
    }).join('');
}

async function loadHistory() {
    const response = await apiRequest(repoApi('history'));
    const commits = (await response.json()).commits;
    const container = document.getElementById('commit-list');
    if (!commits.length) {
        container.innerHTML = '<div class="empty-view">No commits yet. Save your changes and create the first commit.</div>';
        return;
    }
    container.innerHTML = commits.map((commit) => `<article class="timeline-entry"><span class="material-symbols-outlined" aria-hidden="true">commit</span><div class="timeline-main"><strong>${escapeHtml(commit.subject)}</strong><p>${escapeHtml(commit.author)} · ${escapeHtml(new Date(commit.date).toLocaleString())}</p></div><code class="commit-hash">${escapeHtml(commit.shortHash)}</code></article>`).join('');
}

async function loadReadme() {
    try {
        const response = await apiRequest(repoApi('file', { path: 'README.md' }));
        const data = await response.json();
        renderMarkdown(document.getElementById('readme-rendered'), data.content);
    } catch (error) {
        document.getElementById('readme-rendered').innerHTML = '<p>No README.md yet.</p>';
    }
}

async function loadReleases() {
    const response = await apiRequest(repoApi('releases'));
    const releases = (await response.json()).releases;
    const container = document.getElementById('release-list');
    if (!releases.length) {
        container.innerHTML = '<div class="empty-view">No releases yet. Draft a release to create the first version tag.</div>';
        return;
    }
    container.innerHTML = releases.map((release) => `<article class="release-entry"><span class="material-symbols-outlined" aria-hidden="true">new_label</span><div class="release-main"><strong>${escapeHtml(release.tag)}</strong><p>${escapeHtml(release.message)}</p><time>${escapeHtml(new Date(release.date).toLocaleString())}</time></div></article>`).join('');
}

async function refreshRepository() {
    if (!activeRepository) return;
    await Promise.all([loadRepositoryStatus(), loadBranches()]);
    if (activeView === 'commits') await loadHistory();
    if (activeView === 'releases') await loadReleases();
    if (activeView === 'readme') await loadReadme();
}

function setActiveView(view) {
    activeView = view;
    document.querySelectorAll('.repo-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
    document.querySelectorAll('.repo-view').forEach((panel) => panel.classList.toggle('active-view', panel.id === `view-${view}`));
    if (!activeRepository) return;
    if (view === 'changes') loadRepositoryStatus().catch((error) => showRepoStatus(error.message, true));
    if (view === 'commits') loadHistory().catch((error) => showRepoStatus(error.message, true));
    if (view === 'readme') loadReadme().catch((error) => showRepoStatus(error.message, true));
    if (view === 'releases') loadReleases().catch((error) => showRepoStatus(error.message, true));
}

async function createRepository(event) {
    event.preventDefault();
    const name = document.getElementById('repo-name-input').value.trim();
    const description = document.getElementById('repo-description-input').value.trim();
    try {
        await apiRequest('/api/repos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) });
        repoDialog.close();
        document.getElementById('repo-form').reset();
        await loadRepositories();
        await selectRepository(name);
        showRepoStatus(`Created ${name}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

async function commitChanges(event) {
    event.preventDefault();
    const message = document.getElementById('commit-message-input').value.trim();
    try {
        const response = await apiRequest(repoApi('commit'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
        const result = await response.json();
        commitDialog.close();
        document.getElementById('commit-form').reset();
        await refreshRepository();
        showRepoStatus(`Committed ${result.hash.slice(0, 8)}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

async function createBranch(event) {
    event.preventDefault();
    const name = document.getElementById('branch-name-input').value.trim();
    try {
        await apiRequest(repoApi('branches'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        branchDialog.close();
        document.getElementById('branch-form').reset();
        await refreshRepository();
        showRepoStatus(`Switched to ${name}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

async function createRelease(event) {
    event.preventDefault();
    const tag = document.getElementById('release-tag-input').value.trim();
    const message = document.getElementById('release-notes-input').value.trim();
    try {
        await apiRequest(repoApi('releases'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag, message }) });
        releaseDialog.close();
        document.getElementById('release-form').reset();
        await loadReleases();
        showRepoStatus(`Created release ${tag}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

async function configureRemote(event) {
    event.preventDefault();
    const url = document.getElementById('remote-url').value.trim();
    if (!url) return showRepoStatus('Enter an HTTPS or SSH remote URL.', true);
    try {
        await apiRequest(repoApi('remote'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        await loadRepositoryStatus();
        showRepoStatus('Git remote saved');
    } catch (error) { showRepoStatus(error.message, true); }
}

async function pushRepository() {
    const button = document.getElementById('push-button');
    button.disabled = true;
    try {
        await apiRequest(repoApi('push'), { method: 'POST' });
        await refreshRepository();
        showRepoStatus('Push completed');
    } catch (error) { showRepoStatus(error.message, true); }
    finally { button.disabled = false; }
}

async function createRepositoryFile(event) {
    event.preventDefault();
    const filePath = document.getElementById('new-file-path-input').value.trim();
    try {
        await apiRequest(repoApi('file', { path: filePath }), { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: '' });
        newFileDialog.close();
        document.getElementById('new-file-form').reset();
        const parentPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
        await loadTree(parentPath);
        await openFile(filePath);
        showRepoStatus(`Created ${filePath}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

async function deleteCurrentFile() {
    if (!currentFilePath || !window.confirm(`Delete ${currentFilePath}?`)) return;
    try {
        await apiRequest(repoApi('file', { path: currentFilePath }), { method: 'DELETE' });
        const deletedPath = currentFilePath;
        currentFilePath = '';
        originalContent = '';
        if (codeEditor) codeEditor.setValue('');
        document.getElementById('open-file-path').textContent = 'Select a file';
        document.getElementById('delete-file-button').hidden = true;
        document.getElementById('save-file-button').disabled = true;
        await loadTree(currentDirectory);
        await loadRepositoryStatus();
        showRepoStatus(`Deleted ${deletedPath}`);
    } catch (error) { showRepoStatus(error.message, true); }
}

function bindRepoUi() {
    document.getElementById('create-repo-button').addEventListener('click', () => repoDialog.showModal());
    document.querySelectorAll('[data-create-repo]').forEach((button) => button.addEventListener('click', () => repoDialog.showModal()));
    document.getElementById('repo-form').addEventListener('submit', createRepository);
    document.getElementById('repo-search-input').addEventListener('input', updateActiveRepoList);
    document.getElementById('refresh-repos-button').addEventListener('click', loadRepositories);
    repoList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-repo-name]');
        if (button) selectRepository(button.dataset.repoName).catch((error) => showRepoStatus(error.message, true));
    });
    document.querySelectorAll('.repo-tab').forEach((tab) => tab.addEventListener('click', () => setActiveView(tab.dataset.view)));
    document.getElementById('new-repo-file-button').addEventListener('click', () => newFileDialog.showModal());
    document.getElementById('new-file-form').addEventListener('submit', createRepositoryFile);
    document.getElementById('save-file-button').addEventListener('click', saveCurrentFile);
    document.getElementById('delete-file-button').addEventListener('click', deleteCurrentFile);
    document.getElementById('editor-preview-button').addEventListener('click', toggleMarkdownPreview);
    document.getElementById('changes-commit-button').addEventListener('click', () => commitDialog.showModal());
    document.getElementById('commit-form').addEventListener('submit', commitChanges);
    document.getElementById('new-branch-button').addEventListener('click', () => branchDialog.showModal());
    document.getElementById('branch-form').addEventListener('submit', createBranch);
    document.getElementById('branch-select').addEventListener('change', async (event) => {
        try {
            await apiRequest(repoApi('checkout'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: event.target.value }) });
            currentDirectory = '';
            currentFilePath = '';
            await selectRepository(activeRepository);
            showRepoStatus(`Switched to ${event.target.value}`);
        } catch (error) { showRepoStatus(error.message, true); loadBranches(); }
    });
    document.getElementById('remote-form').addEventListener('submit', configureRemote);
    document.getElementById('push-button').addEventListener('click', pushRepository);
    document.getElementById('new-release-button').addEventListener('click', () => releaseDialog.showModal());
    document.getElementById('release-form').addEventListener('submit', createRelease);
    document.querySelectorAll('[data-close-repo-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

    document.getElementById('repo-file-tree').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-entry-path]');
        if (!button) return;
        const entryPath = button.dataset.entryPath;
        try {
            if (button.dataset.isFolder === 'true') await loadTree(entryPath);
            else await openFile(entryPath);
        } catch (error) { showRepoStatus(error.message, true); }
    });
    document.getElementById('repo-breadcrumb').addEventListener('click', (event) => {
        const button = event.target.closest('[data-directory]');
        if (button) loadTree(button.dataset.directory).catch((error) => showRepoStatus(error.message, true));
    });
    document.getElementById('readme-rendered').addEventListener('click', (event) => {
        if (event.target.closest('a')) event.preventDefault();
    });
    document.getElementById('edit-readme-button').addEventListener('click', async () => {
        setActiveView('code');
        try { await openFile('README.md'); }
        catch (error) { showRepoStatus(error.message, true); }
    });
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            saveCurrentFile();
        }
    });
}

bindRepoUi();
createEditor();
loadRepositories();
