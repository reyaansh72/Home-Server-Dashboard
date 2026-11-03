(() => {
    const userIdKey = 'homeServer.chat.userId';
    const usernameKey = 'homeServer.chat.username';
    const profileId = localStorage.getItem(userIdKey) || (window.crypto?.randomUUID?.() || `user-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(userIdKey, profileId);
    let profile = null;
    let resolveAccountReady;
    const accountReady = new Promise((resolve) => { resolveAccountReady = resolve; });

    async function api(url, options = {}) {
        const response = await fetch(url, { cache: 'no-store', ...options });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
        return result;
    }

    function storeProfile(nextProfile) {
        profile = nextProfile;
        localStorage.setItem(usernameKey, nextProfile.username);
        localStorage.setItem('homeServer.account.username', nextProfile.username);
        localStorage.setItem('homeServer.account.avatarId', nextProfile.avatarId || '');
        window.dashboardAccount = nextProfile;
        const button = document.getElementById('dashboard-account-button');
        if (button) renderAccountButton(button);
        window.dispatchEvent(new CustomEvent('dashboard-account-changed', { detail: nextProfile }));
        resolveAccountReady(nextProfile);
    }

    function renderAccountButton(button) {
        button.replaceChildren();
        if (profile?.avatarId) {
            const image = document.createElement('img');
            image.src = `/api/chat/files/${encodeURIComponent(profile.avatarId)}/content`;
            image.alt = '';
            image.className = 'dashboard-account-avatar';
            button.append(image);
        } else {
            const initial = document.createElement('span');
            initial.className = 'dashboard-account-initial';
            initial.textContent = profile?.username?.charAt(0).toUpperCase() || '?';
            button.append(initial);
        }
        const name = document.createElement('span');
        name.className = 'dashboard-account-name';
        name.textContent = profile?.username || 'Account';
        button.append(name);
        button.title = profile ? `Account: ${profile.username}` : 'Set up your account';
        button.setAttribute('aria-label', button.title);
    }

    function addAccountControls() {
        const sidebarTop = document.querySelector('.sidebar-top');
        if (!sidebarTop || document.getElementById('dashboard-account-button')) return;
        const logoLink = sidebarTop.querySelector('a');
        if (logoLink) logoLink.setAttribute('title', 'Dashboard home');
        const button = document.createElement('button');
        button.id = 'dashboard-account-button';
        button.className = 'dashboard-account-button';
        button.type = 'button';
        button.addEventListener('click', () => {
            document.getElementById('dashboard-account-name').value = profile?.username || '';
            document.getElementById('dashboard-account-logo').value = '';
            document.getElementById('dashboard-account-dialog').showModal();
        });
        sidebarTop.append(button);
        renderAccountButton(button);
    }

    function addAccountDialog() {
        if (document.getElementById('dashboard-account-dialog')) return;
        const dialog = document.createElement('dialog');
        dialog.id = 'dashboard-account-dialog';
        dialog.className = 'drive-dialog dashboard-account-dialog';
        dialog.innerHTML = `
            <form id="dashboard-account-form">
                <div class="dialog-header"><div><p class="dialog-kicker">ONE IDENTITY ACROSS YOUR DASHBOARD</p><h2 id="dashboard-account-title">Set up your account</h2></div><button id="dashboard-account-close" class="icon-button dialog-close" type="button" aria-label="Close" hidden><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>
                <label class="dialog-label" for="dashboard-account-name">Username</label>
                <input id="dashboard-account-name" class="dialog-input" type="text" maxlength="32" autocomplete="nickname" required placeholder="Choose a name">
                <label class="dialog-label" for="dashboard-account-logo">Profile logo</label>
                <input id="dashboard-account-logo" class="dialog-input dashboard-account-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif">
                <p id="dashboard-account-hint" class="dashboard-account-hint">Your name and logo appear in Chat, Music, Shorts, Games, and Repositories.</p>
                <p id="dashboard-account-error" class="dashboard-account-error" role="status" aria-live="polite"></p>
                <div class="dialog-actions"><button id="dashboard-account-cancel" class="drive-button" type="button" hidden>Cancel</button><button id="dashboard-account-save" class="drive-button primary-button" type="submit">Save account</button></div>
            </form>`;
        document.body.append(dialog);
        dialog.querySelector('#dashboard-account-form').addEventListener('submit', saveProfile);
        dialog.querySelector('#dashboard-account-close').addEventListener('click', () => dialog.close());
        dialog.querySelector('#dashboard-account-cancel').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog && profile) dialog.close();
        });
    }

    async function saveProfile(event) {
        event.preventDefault();
        const nameInput = document.getElementById('dashboard-account-name');
        const logoInput = document.getElementById('dashboard-account-logo');
        const submit = document.getElementById('dashboard-account-save');
        const error = document.getElementById('dashboard-account-error');
        const username = nameInput.value.trim().replace(/\s+/g, ' ');
        const avatarFile = logoInput.files[0];
        if (!username || username.length > 32) return;
        if (!profile && !avatarFile) {
            error.textContent = 'Choose a profile logo to finish setting up your account.';
            return;
        }
        submit.disabled = true;
        error.textContent = '';
        try {
            let avatarId = profile?.avatarId || null;
            await api('/api/chat/profile', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: profileId, username, avatarId })
            });
            if (avatarFile) {
                const query = new URLSearchParams({ userId: profileId, kind: 'avatar', name: avatarFile.name });
                const uploaded = await api(`/api/chat/upload?${query}`, {
                    method: 'POST', headers: { 'Content-Type': avatarFile.type || 'application/octet-stream' }, body: avatarFile
                });
                avatarId = uploaded.file.id;
            }
            const saved = await api('/api/chat/profile', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: profileId, username, avatarId })
            });
            storeProfile(saved.profile);
            document.getElementById('dashboard-account-dialog').close();
        } catch (saveError) {
            error.textContent = saveError.message;
        } finally {
            submit.disabled = false;
        }
    }

    async function initialize() {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = '/css/account.css';
        document.head.append(stylesheet);
        addAccountControls();
        addAccountDialog();
        try {
            const result = await api(`/api/chat?userId=${encodeURIComponent(profileId)}`);
            if (result.profile) storeProfile(result.profile);
        } catch (error) {
            const target = document.getElementById('dashboard-account-error');
            if (target) target.textContent = error.message;
        }
        if (!profile || !profile.avatarId) {
            const dialog = document.getElementById('dashboard-account-dialog');
            document.getElementById('dashboard-account-title').textContent = profile ? 'Add your profile logo' : 'Set up your account';
            document.getElementById('dashboard-account-hint').textContent = profile
                ? 'Add a logo to complete your shared dashboard profile.'
                : 'Your name and logo will appear in Chat, Music, Shorts, Games, and Repositories.';
            document.getElementById('dashboard-account-close').hidden = !profile;
            document.getElementById('dashboard-account-cancel').hidden = !profile;
            dialog.showModal();
        }
        if (profile?.avatarId) return profile;
        return accountReady;
    }

    window.dashboardAccountReady = initialize().then((result) => result || accountReady);
    window.dashboardAccount = null;
    window.dashboardAccountId = profileId;
    window.dashboardAccountStore = storeProfile;
})();