(() => {
    const audio = document.getElementById('audio-player');
    const fileInput = document.getElementById('music-file');
    const uploadDialog = document.getElementById('upload-dialog');
    const uploadForm = document.getElementById('upload-form');
    const uploadButton = document.getElementById('publish-track');
    const status = document.getElementById('music-status');
    const search = document.getElementById('music-search');
    const trackList = document.getElementById('track-list');
    let tracks = [];
    let currentTrackId = null;
    let shuffle = false;
    let repeat = 0;
    let pendingFile = null;
    let seeking = false;

    function api(url, options = {}) {
        return fetch(url, { cache: 'no-store', ...options }).then(async (response) => {
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
            return result;
        });
    }

    function setStatus(message, isError = false) {
        status.textContent = message;
        status.classList.toggle('error', isError);
    }

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${minutes}:${remainder}`;
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    }

    function formatBytes(bytes) {
        if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function emptyState(message, title = '') {
        const state = document.createElement('div');
        state.className = 'music-state';
        if (title) {
            const empty = document.createElement('div');
            empty.className = 'music-empty';
            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = 'queue_music';
            const heading = document.createElement('strong');
            heading.textContent = title;
            const detail = document.createElement('span');
            detail.textContent = message;
            empty.append(icon, heading, detail);
            state.append(empty);
        } else state.textContent = message;
        return state;
    }

    function actionButton(icon, title, action, className = '') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `icon-button${className ? ` ${className}` : ''}`;
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

    function renderTracks() {
        const query = search.value.trim().toLowerCase();
        const filtered = tracks.filter((track) => `${track.title} ${track.artist} ${track.uploadedBy} ${track.name}`.toLowerCase().includes(query));
        trackList.replaceChildren();
        document.getElementById('track-count').textContent = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`;
        if (!filtered.length) {
            trackList.append(emptyState(query ? 'Try another title, artist, or uploader.' : 'Upload an audio file to start the shared library.', query ? 'No matching tracks' : 'The library is ready'));
            return;
        }

        filtered.forEach((track, index) => {
            const row = document.createElement('article');
            row.className = `music-track-row${track.id === currentTrackId ? ' current-track' : ''}`;
            const number = document.createElement('span');
            number.className = 'track-number';
            number.textContent = String(index + 1).padStart(2, '0');
            const play = actionButton(track.id === currentTrackId && !audio.paused ? 'pause' : 'play_arrow', track.id === currentTrackId && !audio.paused ? 'Pause track' : 'Play track', () => playTrack(track.id), 'track-play');
            const primary = document.createElement('div');
            primary.className = 'track-primary';
            const art = document.createElement('span');
            art.className = 'track-art';
            if (track.avatarId) {
                const avatar = document.createElement('img');
                avatar.src = `/api/chat/files/${encodeURIComponent(track.avatarId)}/content`;
                avatar.alt = '';
                art.append(avatar);
            } else {
                const artIcon = document.createElement('span');
                artIcon.className = 'material-symbols-outlined';
                artIcon.textContent = 'graphic_eq';
                art.append(artIcon);
            }
            const copy = document.createElement('div');
            copy.className = 'track-title-copy';
            const title = document.createElement('strong');
            title.textContent = track.title;
            const artist = document.createElement('span');
            artist.textContent = track.artist || track.name;
            copy.append(title, artist);
            primary.append(art, copy);

            const uploader = document.createElement('span');
            uploader.className = 'track-uploader';
            uploader.textContent = track.uploadedBy;
            const added = document.createElement('span');
            added.className = 'track-added';
            added.textContent = formatDate(track.uploadedAt);
            const actions = document.createElement('div');
            actions.className = 'track-actions';
            actions.append(actionButton('forum', 'Share to global chat', () => shareTrack(track)));
            if (window.dashboardAccount && track.userId === window.dashboardAccount.userId) {
                actions.append(actionButton('edit', 'Edit track details', () => editTrack(track)));
                actions.append(actionButton('delete', 'Remove track', () => deleteTrack(track), 'remove-track'));
            }
            row.append(number, play, primary, uploader, added, actions);
            row.addEventListener('dblclick', (event) => {
                if (!event.target.closest('button')) playTrack(track.id);
            });
            trackList.append(row);
        });
    }

    async function refreshLibrary() {
        try {
            const result = await api('/api/music');
            tracks = result.tracks;
            renderTracks();
            if (currentTrackId && !tracks.some((track) => track.id === currentTrackId)) stopTrack();
        } catch (error) {
            trackList.replaceChildren(emptyState(error.message));
            setStatus(error.message, true);
        }
    }

    function currentIndex() {
        return tracks.findIndex((track) => track.id === currentTrackId);
    }

    function playTrack(id) {
        const track = tracks.find((item) => item.id === id);
        if (!track) return;
        if (id === currentTrackId && !audio.paused) {
            audio.pause();
            return;
        }
        if (id !== currentTrackId) {
            currentTrackId = id;
            audio.src = track.audioUrl;
            audio.load();
            document.getElementById('player-title').textContent = track.title;
            document.getElementById('player-artist').textContent = `${track.artist || track.name} · uploaded by ${track.uploadedBy}`;
            renderTracks();
        }
        audio.play().catch((error) => setStatus(`Unable to play this track: ${error.message}`, true));
    }

    function stopTrack() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        currentTrackId = null;
        document.getElementById('player-title').textContent = 'Nothing playing';
        document.getElementById('player-artist').textContent = 'Select a track from the shared library';
        document.getElementById('current-time').textContent = '0:00';
        document.getElementById('duration-time').textContent = '0:00';
        document.getElementById('seek-bar').value = '0';
        renderTracks();
    }

    function goToTrack(direction) {
        if (!tracks.length) return;
        const index = currentIndex();
        let nextIndex;
        if (shuffle && tracks.length > 1) {
            do { nextIndex = Math.floor(Math.random() * tracks.length); } while (nextIndex === index);
        } else nextIndex = (index + direction + tracks.length) % tracks.length;
        playTrack(tracks[nextIndex].id);
    }

    function openUpload() {
        pendingFile = null;
        fileInput.value = '';
        uploadButton.disabled = true;
        renderUploaderIdentity();
        fileInput.click();
    }

    function renderUploaderIdentity() {
        const container = document.getElementById('music-uploader-identity');
        const account = window.dashboardAccount;
        if (!container || !account) return;
        container.replaceChildren();
        if (account.avatarId) {
            const image = document.createElement('img');
            image.src = `/api/chat/files/${encodeURIComponent(account.avatarId)}/content`;
            image.alt = '';
            container.append(image);
        } else {
            const initial = document.createElement('span');
            initial.textContent = account.username.charAt(0).toUpperCase();
            container.append(initial);
        }
        const label = document.createElement('strong');
        label.textContent = account.username;
        container.append(label);
    }

    fileInput.addEventListener('change', () => {
        pendingFile = fileInput.files[0] || null;
        if (!pendingFile) return;
        const base = pendingFile.name.replace(/\.[^.]+$/, '');
        document.getElementById('track-title').value = base;
        document.getElementById('upload-file-label').textContent = `${pendingFile.name} · ${formatBytes(pendingFile.size)}`;
        uploadButton.disabled = false;
        uploadDialog.showModal();
    });

    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!pendingFile) return;
        const title = document.getElementById('track-title').value.trim();
        const artist = document.getElementById('track-artist').value.trim();
        const account = await window.dashboardAccountReady;
        if (!account || !title) return;
        uploadButton.disabled = true;
        setStatus('Uploading track…');
        try {
            const query = new URLSearchParams({ name: pendingFile.name, title, artist, userId: account.userId });
            const result = await api(`/api/music?${query}`, { method: 'POST', headers: { 'Content-Type': pendingFile.type || 'application/octet-stream' }, body: pendingFile });
            uploadDialog.close();
            uploadForm.reset();
            fileInput.value = '';
            pendingFile = null;
            await refreshLibrary();
            setStatus(`Added “${result.track.title}” to the shared library.`);
        } catch (error) {
            setStatus(error.message, true);
        } finally {
            uploadButton.disabled = !pendingFile;
        }
    });

    async function editTrack(track) {
        const title = window.prompt('Track title', track.title);
        if (title === null) return;
        const artist = window.prompt('Artist', track.artist || '');
        if (artist === null) return;
        try {
            await api(`/api/music/${encodeURIComponent(track.id)}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, artist, userId: window.dashboardAccount.userId })
            });
            await refreshLibrary();
            setStatus('Track details updated.');
        } catch (error) { setStatus(error.message, true); }
    }

    async function deleteTrack(track) {
        if (!window.confirm(`Remove “${track.title}” from the shared library?`)) return;
        try {
            const result = await api(`/api/music/${encodeURIComponent(track.id)}?userId=${encodeURIComponent(window.dashboardAccount.userId)}`, { method: 'DELETE' });
            await refreshLibrary();
            setStatus(result.preservedForChat ? 'Track removed from the library; existing chat shares remain playable.' : 'Track removed from the shared library.');
        } catch (error) { setStatus(error.message, true); }
    }

    async function shareTrack(track) {
        const account = await window.dashboardAccountReady;
        const userId = account?.userId;
        if (!userId) return;
        try {
            const chat = await api(`/api/chat?userId=${encodeURIComponent(userId)}`);
            if (!chat.profile) {
                setStatus('Create a profile in Global Chat before sharing music.', true);
                return;
            }
            await api('/api/chat/messages', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, musicId: track.id, text: '' })
            });
            setStatus(`Shared “${track.title}” to Global Chat.`);
        } catch (error) { setStatus(error.message, true); }
    }

    document.getElementById('open-upload').addEventListener('click', openUpload);
    document.getElementById('refresh-library').addEventListener('click', refreshLibrary);
    search.addEventListener('input', renderTracks);
    document.querySelectorAll('[data-close-upload]').forEach((button) => button.addEventListener('click', () => uploadDialog.close()));
    uploadDialog.addEventListener('click', (event) => { if (event.target === uploadDialog) uploadDialog.close(); });

    const playButton = document.getElementById('play-button');
    playButton.addEventListener('click', () => {
        if (!currentTrackId) {
            if (tracks[0]) playTrack(tracks[0].id);
            return;
        }
        if (audio.paused) audio.play().catch((error) => setStatus(error.message, true));
        else audio.pause();
    });
    document.getElementById('previous-button').addEventListener('click', () => {
        if (audio.currentTime > 3) audio.currentTime = 0;
        else goToTrack(-1);
    });
    document.getElementById('next-button').addEventListener('click', () => goToTrack(1));
    document.getElementById('shuffle-button').addEventListener('click', (event) => {
        shuffle = !shuffle;
        event.currentTarget.classList.toggle('active', shuffle);
        event.currentTarget.setAttribute('aria-pressed', String(shuffle));
    });
    document.getElementById('repeat-button').addEventListener('click', (event) => {
        repeat = (repeat + 1) % 3;
        const button = event.currentTarget;
        button.classList.toggle('active', repeat > 0);
        button.title = repeat === 2 ? 'Repeat track' : repeat === 1 ? 'Repeat library' : 'Repeat off';
        button.setAttribute('aria-label', button.title);
        button.querySelector('span').textContent = repeat === 2 ? 'repeat_one' : 'repeat';
    });
    document.getElementById('seek-bar').addEventListener('input', (event) => {
        seeking = true;
        if (Number.isFinite(audio.duration)) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
    });
    document.getElementById('seek-bar').addEventListener('change', () => { seeking = false; });
    document.getElementById('volume-control').addEventListener('input', (event) => {
        audio.volume = Number(event.target.value);
        localStorage.setItem('homeServer.music.volume', String(audio.volume));
        document.querySelector('.volume-icon').textContent = audio.volume === 0 ? 'volume_off' : audio.volume < .5 ? 'volume_down' : 'volume_up';
    });
    document.getElementById('speed-control').addEventListener('change', (event) => {
        audio.playbackRate = Number(event.target.value);
        localStorage.setItem('homeServer.music.speed', event.target.value);
    });

    audio.addEventListener('play', () => {
        playButton.title = 'Pause';
        playButton.setAttribute('aria-label', 'Pause');
        playButton.querySelector('span').textContent = 'pause';
        renderTracks();
    });
    audio.addEventListener('pause', () => {
        playButton.title = 'Play';
        playButton.setAttribute('aria-label', 'Play');
        playButton.querySelector('span').textContent = 'play_arrow';
        renderTracks();
    });
    audio.addEventListener('loadedmetadata', () => { document.getElementById('duration-time').textContent = formatTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
        document.getElementById('current-time').textContent = formatTime(audio.currentTime);
        if (!seeking && Number.isFinite(audio.duration) && audio.duration > 0) document.getElementById('seek-bar').value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    });
    audio.addEventListener('ended', () => {
        if (repeat === 2) { audio.currentTime = 0; audio.play(); }
        else if (repeat === 1 || currentIndex() < tracks.length - 1) goToTrack(1);
        else {
            playButton.querySelector('span').textContent = 'play_arrow';
            renderTracks();
        }
    });
    audio.addEventListener('error', () => setStatus('This audio format could not be played by the browser.', true));

    audio.volume = Number(localStorage.getItem('homeServer.music.volume') ?? 0.8);
    document.getElementById('volume-control').value = String(audio.volume);
    const savedSpeed = localStorage.getItem('homeServer.music.speed') || '1';
    document.getElementById('speed-control').value = savedSpeed;
    audio.playbackRate = Number(savedSpeed);
    window.dashboardAccountReady.then((account) => {
        renderUploaderIdentity();
        if (account) refreshLibrary();
    }).catch((error) => setStatus(error.message, true));
    window.addEventListener('dashboard-account-changed', renderUploaderIdentity);
})();