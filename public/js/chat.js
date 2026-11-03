const chatUserKey = 'homeServer.chat.userId';
const chatUserId = localStorage.getItem(chatUserKey) || crypto.randomUUID();
localStorage.setItem(chatUserKey, chatUserId);

const messageList = document.getElementById('message-list');
const chatStatus = document.getElementById('chat-status');
const messageInput = document.getElementById('message-input');
const attachmentInput = document.getElementById('attachment-input');
const attachmentPreview = document.getElementById('attachment-preview');
const profileDialog = document.getElementById('profile-dialog');
const fileDialog = document.getElementById('file-dialog');
const emojiPicker = document.getElementById('emoji-picker');
const emojis = ['😀', '😂', '🥰', '😍', '🤔', '😮', '😭', '😎', '🔥', '🎉', '❤️', '👍', '👀', '🙏', '✨', '💯'];
const quickReactions = ['👍', '❤️', '😂', '🔥'];
let profile = null;
let messages = [];
let lastSnapshot = '';
let pendingAttachment = null;
let replyTarget = null;
let activeFile = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingStarted = 0;
let recordingTimer = null;
let searchTerm = '';
let wasAtBottom = true;
let fetchInProgress = false;

function api(path, options = {}) {
    return fetch(path, { cache: 'no-store', ...options }).then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
        return result;
    });
}

function setStatus(message, error = false) {
    chatStatus.textContent = message;
    chatStatus.classList.toggle('chat-status-error', error);
}

function attachmentUrl(fileId) {
    return `/api/chat/files/${encodeURIComponent(fileId)}/content`;
}

function avatarNode(username, avatarId, className = 'chat-avatar') {
    if (avatarId) {
        const image = document.createElement('img');
        image.className = className;
        image.src = attachmentUrl(avatarId);
        image.alt = `${username} avatar`;
        image.loading = 'lazy';
        return image;
    }
    const avatar = document.createElement('span');
    avatar.className = className;
    avatar.textContent = username.trim().charAt(0).toUpperCase() || '?';
    return avatar;
}

function renderProfile() {
    if (!profile) return;
    document.getElementById('header-avatar').replaceWith(avatarNode(profile.username, profile.avatarId, 'chat-avatar'));
    const avatar = document.querySelector('.chat-profile-button .chat-avatar');
    if (avatar) avatar.id = 'header-avatar';
    document.getElementById('header-username').textContent = profile.username;
    document.getElementById('profile-name').value = profile.username;
}

function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatDay(value) {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function scrollToBottom(smooth = false) {
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    wasAtBottom = true;
    document.getElementById('jump-latest').hidden = true;
}

function makeIconButton(icon, title, action, className = 'icon-button') {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    const symbol = document.createElement('span');
    symbol.className = 'material-symbols-outlined';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = icon;
    button.append(symbol);
    button.addEventListener('click', action);
    return button;
}

function renderAttachment(file) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-attachment';
    const url = attachmentUrl(file.id);
    if (file.category === 'image') {
        const image = document.createElement('img');
        image.className = 'message-image';
        image.src = url;
        image.alt = file.name;
        image.loading = 'lazy';
        image.addEventListener('click', () => openFile(file));
        wrapper.append(image);
    } else if (file.category === 'video') {
        const video = document.createElement('video');
        video.className = 'message-video';
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', file.name);
        wrapper.append(video);
    } else if (file.category === 'audio') {
        const audio = document.createElement('audio');
        audio.className = 'message-audio';
        audio.src = url;
        audio.controls = true;
        audio.preload = 'metadata';
        wrapper.append(audio);
    }
    const info = document.createElement('div');
    info.className = 'attachment-info';
    const icon = file.category === 'image' ? 'image' : file.category === 'video' ? 'movie' : file.category === 'audio' ? 'graphic_eq' : 'description';
    const iconElement = document.createElement('span');
    iconElement.className = 'material-symbols-outlined';
    iconElement.textContent = icon;
    const fileButton = document.createElement('button');
    fileButton.className = 'attachment-detail-button';
    fileButton.type = 'button';
    fileButton.textContent = `${file.name} · ${formatBytes(file.size)}`;
    fileButton.addEventListener('click', () => openFile(file));
    info.append(iconElement, fileButton);
    wrapper.append(info);
    return wrapper;
}

function renderMusicTrack(track) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-attachment shared-music-attachment';
    const heading = document.createElement('div');
    heading.className = 'shared-music-heading';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'library_music';
    const copy = document.createElement('div');
    copy.className = 'shared-music-copy';
    const title = document.createElement('strong');
    title.textContent = track.title;
    const metadata = document.createElement('span');
    metadata.textContent = `${track.artist || track.name} · shared by ${track.uploadedBy}`;
    copy.append(title, metadata);
    heading.append(icon, copy);
    const audio = document.createElement('audio');
    audio.className = 'message-audio shared-music-player';
    audio.dataset.trackId = track.id;
    audio.src = track.audioUrl;
    audio.controls = true;
    audio.preload = 'metadata';
    audio.setAttribute('aria-label', `${track.title} by ${track.artist || 'unknown artist'}`);
    const link = document.createElement('a');
    link.className = 'shared-music-library-link';
    link.href = '/music.html';
    link.textContent = 'Open music library';
    wrapper.append(heading, audio, link);
    return wrapper;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
    const units = ['KB', 'MB', 'GB'];
    let size = bytes / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

function renderMessage(message, previousMessage) {
    const fragment = document.createDocumentFragment();
    if (!previousMessage || formatDay(previousMessage.createdAt) !== formatDay(message.createdAt)) {
        const separator = document.createElement('div');
        separator.className = 'date-separator';
        const label = document.createElement('span');
        label.textContent = formatDay(message.createdAt);
        separator.append(label);
        fragment.append(separator);
    }

    const article = document.createElement('article');
    article.className = `chat-message${message.userId === chatUserId ? ' own-message' : ''}${message.isPinned ? ' pinned-message' : ''}`;
    article.dataset.messageId = message.id;
    article.append(avatarNode(message.username, message.avatarId, 'message-avatar'));

    const body = document.createElement('div');
    body.className = 'message-body';
    const top = document.createElement('div');
    top.className = 'message-topline';
    const author = document.createElement('strong');
    author.className = 'message-author';
    author.textContent = message.username;
    const time = document.createElement('time');
    time.dateTime = message.createdAt;
    time.textContent = formatTime(message.createdAt);
    top.append(author, time);
    if (message.editedAt) {
        const edited = document.createElement('span');
        edited.className = 'edited-label';
        edited.textContent = 'edited';
        top.append(edited);
    }
    if (message.isPinned) {
        const pin = document.createElement('span');
        pin.className = 'material-symbols-outlined message-pin';
        pin.title = 'Pinned message';
        pin.textContent = 'push_pin';
        top.append(pin);
    }
    body.append(top);

    if (message.reply) {
        const quote = document.createElement('button');
        quote.className = 'message-reply-quote';
        quote.type = 'button';
        quote.textContent = `${message.reply.username}: ${message.reply.text || message.reply.fileName || message.reply.musicTitle || 'Attachment'}`;
        quote.addEventListener('click', () => document.querySelector(`[data-message-id="${CSS.escape(message.reply.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        body.append(quote);
    }
    if (message.text) {
        const text = document.createElement('p');
        text.className = 'message-text';
        text.textContent = message.text;
        body.append(text);
    }
    if (message.music) body.append(renderMusicTrack(message.music));
    if (message.file) body.append(renderAttachment(message.file));

    const actionRow = document.createElement('div');
    actionRow.className = 'message-actions';
    const reactions = message.reactions || {};
    for (const [emoji, users] of Object.entries(reactions)) {
        if (!users.length) continue;
        const reaction = document.createElement('button');
        reaction.className = `reaction-chip${users.includes(chatUserId) ? ' reaction-selected' : ''}`;
        reaction.type = 'button';
        reaction.textContent = `${emoji} ${users.length}`;
        reaction.title = users.length === 1 ? '1 reaction' : `${users.length} reactions`;
        reaction.addEventListener('click', () => toggleReaction(message.id, emoji));
        actionRow.append(reaction);
    }
    const quickReactionButton = document.createElement('button');
    quickReactionButton.className = 'message-action-icon';
    quickReactionButton.type = 'button';
    quickReactionButton.title = 'React';
    quickReactionButton.setAttribute('aria-label', 'React to message');
    quickReactionButton.textContent = '＋';
    quickReactionButton.addEventListener('click', () => showReactionMenu(message.id, quickReactionButton));
    actionRow.append(quickReactionButton);
    actionRow.append(makeIconButton('reply', 'Reply', () => beginReply(message), 'message-action-icon'));
    actionRow.append(makeIconButton('content_copy', 'Copy message', () => copyMessage(message), 'message-action-icon'));
    actionRow.append(makeIconButton(message.isPinned ? 'keep_off' : 'push_pin', message.isPinned ? 'Unpin message' : 'Pin message', () => togglePin(message), 'message-action-icon'));
    if (message.userId === chatUserId) {
        actionRow.append(makeIconButton('edit', 'Edit message', () => editMessage(message), 'message-action-icon'));
        actionRow.append(makeIconButton('delete', 'Delete message', () => deleteMessage(message), 'message-action-icon danger-action'));
    }
    body.append(actionRow);
    article.append(body);
    fragment.append(article);
    return fragment;
}

function renderPinned(pinned) {
    const pinnedList = document.getElementById('pinned-list');
    const pinnedStrip = document.getElementById('pinned-strip');
    pinnedList.replaceChildren();
    pinnedStrip.replaceChildren();
    if (!pinned.length) {
        const empty = document.createElement('p');
        empty.className = 'side-empty';
        empty.textContent = 'Nothing pinned yet.';
        pinnedList.append(empty);
        pinnedStrip.hidden = true;
        return;
    }
    pinnedStrip.hidden = false;
    for (const message of pinned.slice(-3).reverse()) {
        const button = document.createElement('button');
        button.className = 'pinned-item';
        button.type = 'button';
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'push_pin';
        const content = document.createElement('span');
        content.textContent = `${message.username}: ${message.text || message.file?.name || message.music?.title || 'Attachment'}`;
        button.append(icon, content);
        button.addEventListener('click', () => document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        pinnedList.append(button);
        pinnedStrip.append(button.cloneNode(true));
        pinnedStrip.lastElementChild.addEventListener('click', () => document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
}

function renderMessages(pinned) {
    const atBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 90;
    const musicPlayback = new Map([...messageList.querySelectorAll('.shared-music-player')].map((audio) => [audio.dataset.trackId, {
        currentTime: audio.currentTime,
        paused: audio.paused,
        volume: audio.volume,
        playbackRate: audio.playbackRate
    }]));
    const filtered = searchTerm ? messages.filter((message) => `${message.username} ${message.text} ${message.file?.name || ''} ${message.music?.title || ''} ${message.music?.artist || ''}`.toLowerCase().includes(searchTerm)) : messages;
    document.getElementById('message-count').textContent = String(messages.length);
    renderPinned(pinned);
    if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty';
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = searchTerm ? 'search_off' : 'forum';
        const text = document.createElement('p');
        text.textContent = searchTerm ? 'No messages match your search.' : 'No messages yet. Start the conversation.';
        empty.append(icon, text);
        messageList.replaceChildren(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach((message, index) => fragment.append(renderMessage(message, filtered[index - 1])));
    messageList.replaceChildren(fragment);
    for (const audio of messageList.querySelectorAll('.shared-music-player')) {
        const playback = musicPlayback.get(audio.dataset.trackId);
        if (!playback) continue;
        audio.volume = playback.volume;
        audio.playbackRate = playback.playbackRate;
        audio.addEventListener('loadedmetadata', () => {
            audio.currentTime = Math.min(playback.currentTime, audio.duration || playback.currentTime);
            if (!playback.paused) audio.play().catch(() => {});
        }, { once: true });
    }
    if (atBottom && wasAtBottom && !searchTerm) scrollToBottom();
    else document.getElementById('jump-latest').hidden = false;
}

async function refreshChat() {
    if (fetchInProgress || !profile) return;
    fetchInProgress = true;
    try {
        const result = await api(`/api/chat?userId=${encodeURIComponent(chatUserId)}`);
        profile = result.profile || profile;
        renderProfile();
        const snapshot = JSON.stringify([result.messages, result.pinned]);
        if (snapshot !== lastSnapshot) {
            const previousLatest = messages[messages.length - 1]?.id;
            messages = result.messages;
            lastSnapshot = snapshot;
            renderMessages(result.pinned);
            const latest = messages[messages.length - 1];
            if (previousLatest && latest && latest.id !== previousLatest && latest.userId !== chatUserId && !wasAtBottom) {
                document.getElementById('jump-latest').hidden = false;
                setStatus(`New message from ${latest.username}`);
            } else {
                setStatus('Connected to global chat');
            }
        }
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        fetchInProgress = false;
    }
}

async function ensureProfile() {
    try {
        await window.dashboardAccountReady;
        const result = await api(`/api/chat?userId=${encodeURIComponent(chatUserId)}`);
        if (result.profile) {
            profile = result.profile;
            renderProfile();
            messages = result.messages;
            lastSnapshot = JSON.stringify([result.messages, result.pinned]);
            renderMessages(result.pinned);
            setStatus('Connected to global chat');
            return;
        }
    } catch (error) {
        setStatus(error.message, true);
    }
    document.getElementById('profile-name').value = localStorage.getItem('homeServer.chat.username') || '';
    profileDialog.showModal();
    setStatus('Choose a username to join the server chat');
}

async function uploadFile(file, kind = 'attachment') {
    const query = new URLSearchParams({ userId: chatUserId, kind, name: file.name || `voice-note.${extensionForAudio(file.type)}` });
    const result = await api(`/api/chat/upload?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
    });
    return result.file;
}

function extensionForAudio(mime) {
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mp4')) return 'm4a';
    if (mime.includes('wav')) return 'wav';
    return 'webm';
}

function showPendingAttachment(file) {
    pendingAttachment = file;
    attachmentPreview.hidden = false;
    attachmentPreview.replaceChildren();
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'movie' : 'description';
    const text = document.createElement('span');
    text.textContent = `${file.name} · ${formatBytes(file.size)}`;
    const remove = makeIconButton('close', 'Remove attachment', () => {
        pendingAttachment = null;
        attachmentPreview.hidden = true;
        attachmentPreview.replaceChildren();
        attachmentInput.value = '';
    });
    attachmentPreview.append(icon, text, remove);
}

async function sendMessage(text = messageInput.value.trim(), file = pendingAttachment) {
    if (!profile) return;
    if (!text && !file) return;
    const sendButton = document.querySelector('.send-button');
    sendButton.disabled = true;
    setStatus(file ? 'Uploading attachment…' : 'Sending…');
    try {
        let fileRecord = null;
        if (file) fileRecord = await uploadFile(file, 'attachment');
        const result = await api('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: chatUserId, text, fileId: fileRecord?.id || null, replyTo: replyTarget?.id || null })
        });
        messages.push(result.message);
        lastSnapshot = '';
        messageInput.value = '';
        autoResizeMessageInput();
        pendingAttachment = null;
        attachmentPreview.hidden = true;
        attachmentPreview.replaceChildren();
        attachmentInput.value = '';
        cancelReply();
        await refreshChat();
        scrollToBottom(true);
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        sendButton.disabled = false;
        messageInput.focus();
    }
}

async function openMusicSharePicker() {
    const dialog = document.getElementById('music-share-dialog');
    const list = document.getElementById('music-share-list');
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'file-comments-empty';
    loading.textContent = 'Loading shared tracks…';
    list.append(loading);
    dialog.showModal();
    try {
        const result = await api('/api/music');
        list.replaceChildren();
        if (!result.tracks.length) {
            const empty = document.createElement('p');
            empty.className = 'file-comments-empty';
            empty.textContent = 'The music library is empty. Add a track from the Music page first.';
            list.append(empty);
            return;
        }
        for (const track of result.tracks) {
            const row = document.createElement('div');
            row.className = 'music-share-row';
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = 'graphic_eq';
            const info = document.createElement('div');
            info.className = 'music-share-info';
            const title = document.createElement('strong');
            title.textContent = track.title;
            const detail = document.createElement('span');
            detail.textContent = `${track.artist || track.name} · ${track.uploadedBy}`;
            info.append(title, detail);
            const share = document.createElement('button');
            share.className = 'drive-button primary-button';
            share.type = 'button';
            share.textContent = 'Share';
            share.addEventListener('click', () => shareMusicToChat(track, share));
            row.append(icon, info, share);
            list.append(row);
        }
    } catch (error) {
        list.replaceChildren();
        const message = document.createElement('p');
        message.className = 'file-comments-empty';
        message.textContent = error.message;
        list.append(message);
    }
}

async function shareMusicToChat(track, button) {
    if (!profile) return setStatus('Set up your chat profile before sharing a track', true);
    button.disabled = true;
    try {
        await api('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: chatUserId, musicId: track.id, text: '' })
        });
        document.getElementById('music-share-dialog').close();
        lastSnapshot = '';
        await refreshChat();
        scrollToBottom(true);
        setStatus(`Shared “${track.title}” with the server`);
    } catch (error) {
        setStatus(error.message, true);
        button.disabled = false;
    }
}

function autoResizeMessageInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
}

function beginReply(message) {
    replyTarget = message;
    const preview = document.getElementById('reply-preview');
    const snippet = (message.text || message.file?.name || 'Attachment').slice(0, 100);
    document.getElementById('reply-preview-text').textContent = `Replying to ${message.username}: ${snippet}`;
    preview.hidden = false;
    messageInput.focus();
}

function cancelReply() {
    replyTarget = null;
    document.getElementById('reply-preview').hidden = true;
}

async function toggleReaction(messageId, emoji) {
    try {
        await api(`/api/chat/messages/${messageId}/reactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: chatUserId, emoji }) });
        lastSnapshot = '';
        await refreshChat();
    } catch (error) { setStatus(error.message, true); }
}

function showReactionMenu(messageId, button) {
    document.querySelectorAll('.reaction-menu').forEach((menu) => menu.remove());
    const menu = document.createElement('div');
    menu.className = 'reaction-menu';
    for (const emoji of emojis.slice(0, 10)) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = emoji;
        choice.setAttribute('aria-label', `React ${emoji}`);
        choice.addEventListener('click', () => { menu.remove(); toggleReaction(messageId, emoji); });
        menu.append(choice);
    }
    button.parentElement.append(menu);
}

async function togglePin(message) {
    try {
        await api(`/api/chat/messages/${message.id}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: chatUserId, pinned: !message.isPinned }) });
        lastSnapshot = '';
        await refreshChat();
    } catch (error) { setStatus(error.message, true); }
}

async function editMessage(message) {
    const nextText = window.prompt('Edit message', message.text);
    if (nextText === null || nextText.trim() === message.text) return;
    try {
        await api(`/api/chat/messages/${message.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: chatUserId, text: nextText }) });
        lastSnapshot = '';
        await refreshChat();
    } catch (error) { setStatus(error.message, true); }
}

async function deleteMessage(message) {
    if (!window.confirm('Delete this message?')) return;
    try {
        await api(`/api/chat/messages/${message.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: chatUserId }) });
        lastSnapshot = '';
        await refreshChat();
    } catch (error) { setStatus(error.message, true); }
}

async function copyMessage(message) {
    try {
        await navigator.clipboard.writeText(message.text || message.file?.name || '');
        setStatus('Message copied');
    } catch { setStatus('Clipboard access is unavailable', true); }
}

function renderFileComments(comments) {
    const list = document.getElementById('file-comments-list');
    list.replaceChildren();
    if (!comments.length) {
        const empty = document.createElement('p');
        empty.className = 'file-comments-empty';
        empty.textContent = 'No comments on this file yet.';
        list.append(empty);
        return;
    }
    for (const comment of comments) {
        const entry = document.createElement('article');
        entry.className = 'file-comment';
        const head = document.createElement('div');
        head.className = 'file-comment-head';
        const author = document.createElement('strong');
        author.textContent = comment.username;
        const time = document.createElement('time');
        time.textContent = formatTime(comment.createdAt);
        head.append(author, time);
        const text = document.createElement('p');
        text.textContent = comment.text;
        entry.append(head, text);
        list.append(entry);
    }
}

function openFile(file) {
    activeFile = file;
    document.getElementById('file-dialog-title').textContent = file.name;
    const preview = document.getElementById('file-dialog-preview');
    preview.replaceChildren();
    if (file.category === 'image') {
        const image = document.createElement('img');
        image.src = attachmentUrl(file.id);
        image.alt = file.name;
        preview.append(image);
    } else if (file.category === 'video') {
        const video = document.createElement('video');
        video.src = attachmentUrl(file.id);
        video.controls = true;
        video.autoplay = false;
        preview.append(video);
    } else if (file.category === 'audio') {
        const audio = document.createElement('audio');
        audio.src = attachmentUrl(file.id);
        audio.controls = true;
        preview.append(audio);
    } else {
        const link = document.createElement('a');
        link.href = attachmentUrl(file.id);
        link.className = 'file-download-link';
        link.download = file.name;
        link.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">download</span>Download file';
        preview.append(link);
    }
    renderFileComments(file.comments || []);
    fileDialog.showModal();
}

async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setStatus('Voice recording is not supported by this browser', true);
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferred = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
        mediaRecorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.addEventListener('dataavailable', (event) => { if (event.data.size) audioChunks.push(event.data); });
        mediaRecorder.addEventListener('stop', async () => {
            stream.getTracks().forEach((track) => track.stop());
            clearInterval(recordingTimer);
            document.getElementById('recording-status').hidden = true;
            document.getElementById('voice-button').hidden = false;
            const type = mediaRecorder.mimeType || 'audio/webm';
            const extension = extensionForAudio(type);
            const voice = new File(audioChunks, `voice-note-${Date.now()}.${extension}`, { type });
            await sendMessage('', voice);
        });
        mediaRecorder.start();
        recordingStarted = Date.now();
        document.getElementById('voice-button').hidden = true;
        document.getElementById('recording-status').hidden = false;
        recordingTimer = setInterval(() => {
            const seconds = Math.floor((Date.now() - recordingStarted) / 1000);
            document.getElementById('recording-time').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
            if (seconds >= 120) stopRecording();
        }, 500);
        setStatus('Recording voice note');
    } catch (error) { setStatus(`Microphone unavailable: ${error.message}`, true); }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function buildEmojiPicker() {
    emojiPicker.replaceChildren();
    for (const emoji of emojis) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = emoji;
        button.setAttribute('aria-label', `Insert ${emoji}`);
        button.addEventListener('click', () => {
            const start = messageInput.selectionStart;
            const end = messageInput.selectionEnd;
            messageInput.setRangeText(emoji, start, end, 'end');
            autoResizeMessageInput();
            messageInput.focus();
            emojiPicker.hidden = true;
        });
        emojiPicker.append(button);
    }
}

async function saveProfile(event) {
    event.preventDefault();
    const username = document.getElementById('profile-name').value.trim();
    const avatarFile = document.getElementById('avatar-input').files[0];
    if (!username) return;
    const submit = profileDialog.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        let avatarId = profile?.avatarId ?? null;
        if (avatarFile) avatarId = (await uploadFile(avatarFile, 'avatar')).id;
        const result = await api('/api/chat/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: chatUserId, username, avatarId }) });
        profile = result.profile;
        localStorage.setItem('homeServer.chat.username', username);
        window.dashboardAccountStore?.(result.profile);
        renderProfile();
        profileDialog.close();
        setStatus('Profile saved. Welcome to global chat.');
        await refreshChat();
    } catch (error) { setStatus(error.message, true); }
    finally { submit.disabled = false; }
}

async function commentOnFile(event) {
    event.preventDefault();
    if (!activeFile) return;
    const input = document.getElementById('file-comment-input');
    const text = input.value.trim();
    if (!text) return;
    try {
        const result = await api(`/api/chat/files/${activeFile.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: chatUserId, text }) });
        activeFile.comments = [...(activeFile.comments || []), result.comment];
        renderFileComments(activeFile.comments);
        input.value = '';
    } catch (error) { setStatus(error.message, true); }
}

document.getElementById('message-form').addEventListener('submit', (event) => { event.preventDefault(); sendMessage(); });
messageInput.addEventListener('input', autoResizeMessageInput);
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
});
document.getElementById('attach-button').addEventListener('click', () => attachmentInput.click());
document.getElementById('share-music-button').addEventListener('click', openMusicSharePicker);
attachmentInput.addEventListener('change', () => { if (attachmentInput.files[0]) showPendingAttachment(attachmentInput.files[0]); });
document.getElementById('emoji-button').addEventListener('click', () => { emojiPicker.hidden = !emojiPicker.hidden; });
document.getElementById('voice-button').addEventListener('click', startRecording);
document.getElementById('stop-recording').addEventListener('click', stopRecording);
document.getElementById('cancel-reply').addEventListener('click', cancelReply);
document.getElementById('jump-latest').addEventListener('click', () => scrollToBottom(true));
document.getElementById('refresh-chat').addEventListener('click', () => { lastSnapshot = ''; refreshChat(); });
document.getElementById('profile-button').addEventListener('click', () => { document.getElementById('avatar-input').value = ''; profileDialog.showModal(); });
document.getElementById('profile-form').addEventListener('submit', saveProfile);
document.getElementById('file-comment-form').addEventListener('submit', commentOnFile);
document.getElementById('chat-search-input').addEventListener('input', (event) => { searchTerm = event.target.value.trim().toLowerCase(); renderMessages(messages.filter((message) => message.isPinned)); });
messageList.addEventListener('scroll', () => {
    wasAtBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 90;
    if (wasAtBottom) document.getElementById('jump-latest').hidden = true;
});
messageList.addEventListener('dragover', (event) => { event.preventDefault(); messageList.classList.add('chat-drop-target'); });
messageList.addEventListener('dragleave', (event) => { if (!messageList.contains(event.relatedTarget)) messageList.classList.remove('chat-drop-target'); });
messageList.addEventListener('drop', (event) => {
    event.preventDefault();
    messageList.classList.remove('chat-drop-target');
    const file = event.dataTransfer.files[0];
    if (file) { showPendingAttachment(file); messageInput.focus(); }
});
document.getElementById('profile-dialog').addEventListener('click', (event) => { if (event.target === profileDialog) profileDialog.close(); });
document.getElementById('file-dialog').addEventListener('click', (event) => { if (event.target === fileDialog) fileDialog.close(); });
document.querySelectorAll('[data-close-chat-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('[data-close-music-share]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
window.addEventListener('beforeunload', () => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); });

buildEmojiPicker();
ensureProfile().then(() => { if (profile) refreshChat(); });
setInterval(refreshChat, 4000);
