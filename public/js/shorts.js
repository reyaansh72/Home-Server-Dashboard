const feed = document.getElementById('shorts-feed');
const statusLine = document.getElementById('shorts-status');
const uploadDialog = document.getElementById('upload-short-dialog');
const commentsDialog = document.getElementById('short-comments-dialog');
const shortInput = document.getElementById('short-file-input');
const selectedName = document.getElementById('selected-video-name');
const publishButton = document.getElementById('publish-short-button');
const selectedShortsFileTypes = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const createViewerId = () => window.crypto?.randomUUID?.() || `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const shortsViewerId = localStorage.getItem('home-shorts-viewer') || createViewerId();
localStorage.setItem('home-shorts-viewer', shortsViewerId);
let account = null;
let videos = [];
let selectedUpload = null;
let activeCommentVideo = null;
let scrollTimer;
let statusTimer;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

const apiPath = (path) => {
    const query = new URLSearchParams({ path });
    return `/api/files/upload?${query}`;
};

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
    statusLine.textContent = message;
    statusLine.classList.toggle('error', isError);
    if (message) statusTimer = window.setTimeout(() => { statusLine.textContent = ''; }, 4500);
}

function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function renderShorts() {
    document.getElementById('shorts-loading').hidden = true;
    document.getElementById('shorts-error').hidden = true;
    document.getElementById('shorts-empty').hidden = videos.length > 0;
    document.getElementById('shorts-count').textContent = `${videos.length} clip${videos.length === 1 ? '' : 's'}`;
    feed.querySelectorAll('.short-card').forEach((card) => card.remove());

    videos.forEach((video, index) => {
        const card = document.createElement('article');
        card.className = 'short-card';
        card.dataset.shortId = video.id;
        card.innerHTML = `
            <div class="short-player paused">
                <video src="/api/shorts/${encodeURIComponent(video.id)}/video" preload="metadata" playsinline loop aria-label="Short video: ${escapeHtml(video.caption || video.name)}"></video>
                <div class="short-topline"><span class="short-type-pill">SHORTS · ${escapeHtml(video.name.split('.').pop().toUpperCase())}</span><span class="short-index">${index + 1} / ${videos.length}</span></div>
                <div class="short-player-controls">
                    <button class="icon-button" type="button" data-action="mute" title="Mute or unmute" aria-label="Mute or unmute"><span class="material-symbols-outlined" aria-hidden="true">volume_off</span></button>
                    <button class="icon-button" type="button" data-action="fullscreen" title="Fullscreen" aria-label="Fullscreen"><span class="material-symbols-outlined" aria-hidden="true">fullscreen</span></button>
                </div>
                <button class="short-player-button" type="button" data-action="play" aria-label="Play video"><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span></button>
                <div class="short-bottom"><div class="short-uploader"></div><p class="short-filename">${escapeHtml(video.name)}</p><p class="short-caption">${escapeHtml(video.caption || '')}</p><p class="short-time">Added ${escapeHtml(formatDate(video.uploadedAt))}</p></div>
            </div>
            <div class="short-rail">
                <button class="short-action like-action ${video.liked ? 'liked' : ''}" type="button" data-action="like" aria-label="${video.liked ? 'Unlike' : 'Like'}" aria-pressed="${video.liked}"><span class="short-action-icon"><span class="material-symbols-outlined" aria-hidden="true">favorite</span></span><span class="like-count">${video.likes}</span></button>
                <button class="short-action" type="button" data-action="comments" aria-label="Open ${video.comments.length} comments"><span class="short-action-icon"><span class="material-symbols-outlined" aria-hidden="true">chat_bubble</span></span><span>${video.comments.length}</span></button>
                <button class="short-action" type="button" data-action="share" aria-label="Copy video link"><span class="short-action-icon"><span class="material-symbols-outlined" aria-hidden="true">link</span></span><span>Link</span></button>
                <details class="short-card-menu"><summary class="short-action" aria-label="More video actions" title="More actions"><span class="short-action-icon"><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span></span></summary><div class="short-menu-items"><button type="button" data-action="download"><span class="material-symbols-outlined" aria-hidden="true">download</span>Download</button>${video.userId === account?.userId ? '<button type="button" data-action="delete"><span class="material-symbols-outlined" aria-hidden="true">delete</span>Delete</button>' : ''}</div></details>
            </div>`;
        feed.append(card);
        renderIdentity(card.querySelector('.short-uploader'), video.uploadedBy, video.avatarId);
        const player = card.querySelector('video');
        player.muted = true;
        player.addEventListener('play', () => {
            card.querySelector('.short-player').classList.remove('paused');
            card.querySelector('[data-action="play"] .material-symbols-outlined').textContent = 'pause';
            card.querySelector('[data-action="play"]').setAttribute('aria-label', 'Pause video');
        });
        player.addEventListener('pause', () => {
            card.querySelector('.short-player').classList.add('paused');
            card.querySelector('[data-action="play"] .material-symbols-outlined').textContent = 'play_arrow';
            card.querySelector('[data-action="play"]').setAttribute('aria-label', 'Play video');
        });
        player.addEventListener('volumechange', () => {
            card.querySelector('[data-action="mute"] .material-symbols-outlined').textContent = player.muted ? 'volume_off' : 'volume_up';
        });
    });

    scheduleActivePlayback();
}

async function loadShorts() {
    try {
        const response = await apiRequest(`/api/shorts?viewerId=${encodeURIComponent(shortsViewerId)}`);
        videos = (await response.json()).videos;
        renderShorts();
    } catch (error) {
        document.getElementById('shorts-loading').hidden = true;
        document.getElementById('shorts-empty').hidden = true;
        document.getElementById('shorts-count').textContent = 'Feed unavailable';
        const errorBox = document.getElementById('shorts-error');
        errorBox.hidden = false;
        errorBox.textContent = `${error.message}. Shorts requires the Node server; a static-only server cannot load or save videos.`;
        showStatus(error.message, true);
    }
}

function scheduleActivePlayback() {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
        const cards = [...feed.querySelectorAll('.short-card')];
        if (!cards.length) return;
        const feedBounds = feed.getBoundingClientRect();
        const center = feedBounds.top + feedBounds.height / 2;
        const active = cards.reduce((best, card) => {
            const bounds = card.getBoundingClientRect();
            const distance = Math.abs(bounds.top + bounds.height / 2 - center);
            return !best || distance < best.distance ? { card, distance } : best;
        }, null)?.card;
        cards.forEach((card) => {
            const player = card.querySelector('video');
            if (card === active && active.getBoundingClientRect().height > 0) {
                player.play().catch(() => card.querySelector('.short-player').classList.add('paused'));
            } else {
                player.pause();
            }
        });
    }, 90);
}

async function uploadShort(file) {
    const extension = `.${file.name.split('.').pop().toLowerCase()}`;
    if (!selectedShortsFileTypes.has(extension)) throw new Error('Choose an MP4, WebM, MOV, or M4V video.');
    if (file.size > 250 * 1024 * 1024) throw new Error('Videos must be 250 MB or smaller.');

    showStatus('Uploading video...');
    const query = new URLSearchParams({ name: file.name, path: 'Shorts' });
    await apiRequest(`/api/files/upload?${query}`, {
        method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file
    });
    const shortPath = `Shorts/${file.name}`;
    let response;
    try {
        response = await apiRequest('/api/shorts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: shortPath, caption: document.getElementById('short-caption').value, userId: account.userId })
        });
    } catch (error) {
        await apiRequest(`/api/files?path=${encodeURIComponent(shortPath)}`, { method: 'DELETE' }).catch(() => {});
        throw error;
    }
    const { video } = await response.json();
    uploadDialog.close();
    selectedUpload = null;
    shortInput.value = '';
    document.getElementById('short-caption').value = '';
    showStatus('Video published');
    await loadShorts();
    const newCard = feed.querySelector(`[data-short-id="${CSS.escape(video.id)}"]`);
    newCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    scheduleActivePlayback();
}

function showComments(video) {
    activeCommentVideo = video;
    document.getElementById('comments-title').textContent = `Comments · ${video.comments.length}`;
    const list = document.getElementById('short-comments-list');
    if (!video.comments.length) {
        list.innerHTML = '<p class="comments-empty">No comments yet. Start the conversation.</p>';
    } else {
        list.innerHTML = [...video.comments].reverse().map((comment) => `<article class="short-comment"><div class="short-comment-head"><span class="short-comment-author">${comment.avatarId ? `<img src="/api/chat/files/${encodeURIComponent(comment.avatarId)}/content" alt="">` : `<span>${escapeHtml(comment.name.charAt(0).toUpperCase())}</span>`}<strong>${escapeHtml(comment.name)}</strong></span><time>${escapeHtml(formatDate(comment.createdAt))}</time></div><p>${escapeHtml(comment.text)}</p></article>`).join('');
    }
    renderIdentity(document.getElementById('short-comment-identity'), account.username, account.avatarId);
    commentsDialog.showModal();
    document.getElementById('comment-text').focus();
}

feed.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('[data-short-id]');
    const video = videos.find((entry) => entry.id === card?.dataset.shortId);
    if (!video) return;
    const player = card.querySelector('video');
    try {
        switch (button.dataset.action) {
            case 'play':
                if (player.paused) await player.play();
                else player.pause();
                break;
            case 'mute':
                player.muted = !player.muted;
                break;
            case 'fullscreen':
                if (card.querySelector('.short-player').requestFullscreen) await card.querySelector('.short-player').requestFullscreen();
                break;
            case 'like': {
                const response = await apiRequest(`/api/shorts/${encodeURIComponent(video.id)}/like`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ viewerId: shortsViewerId })
                });
                const result = await response.json();
                video.likes = result.likes;
                video.liked = result.liked;
                button.classList.toggle('liked', result.liked);
                button.setAttribute('aria-pressed', String(result.liked));
                button.setAttribute('aria-label', result.liked ? 'Unlike' : 'Like');
                button.querySelector('.like-count').textContent = result.likes;
                break;
            }
            case 'comments':
                showComments(video);
                break;
            case 'share': {
                const link = `${location.origin}/shorts.html#${encodeURIComponent(video.id)}`;
                await navigator.clipboard.writeText(link);
                showStatus('Video link copied');
                break;
            }
            case 'download': {
                const anchor = document.createElement('a');
                anchor.href = `/api/shorts/${encodeURIComponent(video.id)}/video`;
                anchor.download = video.name;
                anchor.click();
                break;
            }
            case 'delete':
                if (!window.confirm(`Delete “${video.name}” and its comments?`)) break;
                await apiRequest(`/api/shorts/${encodeURIComponent(video.id)}?userId=${encodeURIComponent(account.userId)}`, { method: 'DELETE' });
                await loadShorts();
                showStatus('Video deleted');
                break;
        }
    } catch (error) {
        showStatus(error.message, true);
    }
});

function renderIdentity(container, username, avatarId) {
    if (!container) return;
    container.replaceChildren();
    if (avatarId) {
        const image = document.createElement('img');
        image.src = `/api/chat/files/${encodeURIComponent(avatarId)}/content`;
        image.alt = '';
        container.append(image);
    } else {
        const initial = document.createElement('span');
        initial.textContent = username?.charAt(0).toUpperCase() || '?';
        container.append(initial);
    }
    const name = document.createElement('strong');
    name.textContent = username || 'Account';
    container.append(name);
}

document.getElementById('short-comment-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeCommentVideo) return;
    const textInput = document.getElementById('comment-text');
    try {
        const response = await apiRequest(`/api/shorts/${encodeURIComponent(activeCommentVideo.id)}/comments`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewerId: shortsViewerId, userId: account.userId, text: textInput.value })
        });
        const result = await response.json();
        activeCommentVideo.comments.push(result.comment);
        textInput.value = '';
        showComments(activeCommentVideo);
        const commentButton = feed.querySelector(`[data-short-id="${CSS.escape(activeCommentVideo.id)}"] [data-action="comments"]`);
        commentButton.querySelector('span:last-child').textContent = activeCommentVideo.comments.length;
        commentButton.setAttribute('aria-label', `Open ${activeCommentVideo.comments.length} comments`);
    } catch (error) {
        showStatus(error.message, true);
    }
});

document.getElementById('upload-short-button').addEventListener('click', () => shortInput.click());
document.querySelectorAll('[data-open-uploader]').forEach((button) => button.addEventListener('click', () => shortInput.click()));
shortInput.addEventListener('change', (event) => {
    selectedUpload = event.target.files[0] || null;
    publishButton.disabled = !selectedUpload;
    selectedName.querySelector('span:last-child').textContent = selectedUpload
        ? `${selectedUpload.name} · ${(selectedUpload.size / (1024 * 1024)).toFixed(1)} MB`
        : 'Choose an MP4, WebM, MOV, or M4V video (up to 250 MB).';
    if (selectedUpload) uploadDialog.showModal();
});
document.getElementById('upload-short-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedUpload) return;
    publishButton.disabled = true;
    try { await uploadShort(selectedUpload); }
    catch (error) { showStatus(error.message, true); }
    finally { publishButton.disabled = !selectedUpload; }
});
document.querySelectorAll('[data-close-short-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

feed.addEventListener('scroll', scheduleActivePlayback, { passive: true });
feed.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) return;
    event.preventDefault();
    const cards = [...feed.querySelectorAll('.short-card')];
    if (!cards.length) return;
    const currentIndex = cards.findIndex((card) => {
        const bounds = card.getBoundingClientRect();
        return bounds.top >= feed.getBoundingClientRect().top - 30 && bounds.top < feed.getBoundingClientRect().bottom;
    });
    const delta = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1;
    cards[Math.max(0, Math.min(cards.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta))].scrollIntoView({ behavior: 'smooth', block: 'center' });
});
window.addEventListener('resize', scheduleActivePlayback);

window.dashboardAccountReady.then((profile) => {
    account = profile;
    renderIdentity(document.getElementById('short-comment-identity'), profile.username, profile.avatarId);
    return loadShorts();
}).catch((error) => showStatus(error.message, true));
window.addEventListener('dashboard-account-changed', (event) => {
    account = event.detail;
    renderIdentity(document.getElementById('short-comment-identity'), account.username, account.avatarId);
    loadShorts();
});
