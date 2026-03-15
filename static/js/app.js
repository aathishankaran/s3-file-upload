/* ================================================================
   S3 File Manager — Frontend Logic
   ================================================================ */

const state = {
    user: null,
    currentPrefix: '',
    s3Bucket: '',
    s3Region: '',
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
    try {
        const res = await api('GET', '/api/me');
        state.user = res;
        if (res.must_change_password) {
            showOnlyView('view-change-password-force');
            return;
        }
        document.getElementById('app-header').style.display = '';
        document.getElementById('nav-admin').style.display = res.role === 'admin' ? '' : 'none';
        document.querySelectorAll('.admin-only-action').forEach(el => el.style.display = res.role === 'admin' ? '' : 'none');
        // Load S3 info
        try {
            const s3Info = await api('GET', '/api/s3/info');
            state.s3Bucket = s3Info.bucket;
            state.s3Region = s3Info.region;
            document.getElementById('s3-bucket-name').textContent = s3Info.bucket;
            document.getElementById('s3-region').textContent = s3Info.region;
        } catch { /* ignore */ }
        showView('browser');
    } catch {
        showOnlyView('view-login');
    }
}

// ---------------------------------------------------------------------------
// API Helper
// ---------------------------------------------------------------------------
async function api(method, url, body, isForm) {
    const opts = { method, credentials: 'same-origin' };
    if (body && !isForm) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    } else if (body && isForm) {
        opts.body = body;
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ---------------------------------------------------------------------------
// View Management
// ---------------------------------------------------------------------------
function showOnlyView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        v.style.display = 'none';
        v.classList.remove('active');
    });
    const el = document.getElementById(viewId);
    if (el) { el.style.display = ''; el.classList.add('active'); }
}

function showView(name) {
    document.getElementById('app-header').style.display = '';
    closeUploadConsole();
    closePreviewPanel();
    showOnlyView('view-' + name);
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.toggle('active', l.dataset.view === name);
    });
    if (name === 'browser') navigateTo(state.currentPrefix);
    if (name === 'profile') loadProfile();
    if (name === 'admin') loadAdminUsers();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function doLogin(e) {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
        const res = await api('POST', '/api/login', { username, password });
        state.user = res;
        if (res.must_change_password) {
            showOnlyView('view-change-password-force');
            return;
        }
        document.getElementById('app-header').style.display = '';
        document.getElementById('nav-admin').style.display = res.role === 'admin' ? '' : 'none';
        document.querySelectorAll('.admin-only-action').forEach(el => el.style.display = res.role === 'admin' ? '' : 'none');
        // Load S3 info
        try {
            const s3Info = await api('GET', '/api/s3/info');
            state.s3Bucket = s3Info.bucket;
            state.s3Region = s3Info.region;
            document.getElementById('s3-bucket-name').textContent = s3Info.bucket;
            document.getElementById('s3-region').textContent = s3Info.region;
        } catch { /* ignore */ }
        showView('browser');
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
    }
}

async function doLogout() {
    try { await api('POST', '/api/logout'); } catch { /* ignore */ }
    state.user = null;
    state.currentPrefix = '';
    document.getElementById('app-header').style.display = 'none';
    showOnlyView('view-login');
    document.getElementById('login-password').value = '';
}

async function doForceChangePassword(e) {
    e.preventDefault();
    const errEl = document.getElementById('force-pw-error');
    errEl.style.display = 'none';
    const oldPw = document.getElementById('force-old-pw').value;
    const newPw = document.getElementById('force-new-pw').value;
    const confirmPw = document.getElementById('force-confirm-pw').value;
    if (newPw !== confirmPw) {
        errEl.textContent = 'Passwords do not match';
        errEl.style.display = '';
        return;
    }
    try {
        await api('POST', '/api/change-password', { old_password: oldPw, new_password: newPw });
        toast('Password changed successfully', 'success');
        init();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
    }
}

// ---------------------------------------------------------------------------
// S3 Browser
// ---------------------------------------------------------------------------
async function navigateTo(prefix) {
    state.currentPrefix = prefix;
    renderBreadcrumbs(prefix);
    // Hide upload buttons at root level, show inside folders
    const isRoot = !prefix;
    document.querySelectorAll('.upload-action').forEach(el => el.style.display = isRoot ? 'none' : '');
    // Update S3 full path
    const fullPathEl = document.getElementById('s3-full-path');
    if (fullPathEl && state.s3Bucket) {
        fullPathEl.textContent = 's3://' + state.s3Bucket + '/' + (prefix || '');
    }
    const tbody = document.getElementById('file-tbody');
    const emptyState = document.getElementById('empty-state');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</td></tr>';
    emptyState.style.display = 'none';
    try {
        const res = await api('GET', '/api/s3/list?prefix=' + encodeURIComponent(prefix));
        if (res.items.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = '';
            return;
        }
        emptyState.style.display = 'none';
        tbody.innerHTML = res.items.map(item => {
            if (item.type === 'folder') {
                const folderPath = prefix + item.name;
                return `<tr>
                    <td><div class="file-name" onclick="navigateTo('${escHtml(folderPath)}')">
                        <svg class="file-icon file-icon-folder" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>
                        ${escHtml(item.name)}
                    </div></td>
                    <td>—</td>
                    <td>—</td>
                    <td></td>
                </tr>`;
            }
            const fileKey = prefix + item.name;
            const ext = item.name.split('.').pop().toLowerCase();
            const previewable = ['txt','csv','json','xml','html','css','js','md','log','yaml','yml','ini','cfg','conf','py','java','sh','sql','tsv','dat','cob','cpy','jcl'].includes(ext);
            const imageFile = ['png','jpg','jpeg','gif','bmp','svg','webp','ico'].includes(ext);
            const pdfFile = ext === 'pdf';
            const canPreview = previewable || imageFile || pdfFile;
            const rowId = 'file-row-' + btoa(fileKey).replace(/[^a-zA-Z0-9]/g, '');
            return `<tr id="${rowId}" data-file-key="${escHtml(fileKey)}">
                <td><div class="file-name">
                    <svg class="file-icon file-icon-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ${escHtml(item.name)}
                </div></td>
                <td>${formatSize(item.size)}</td>
                <td>${item.last_modified ? formatDate(item.last_modified) : '—'}</td>
                <td class="file-actions">
                    ${canPreview ? `<button class="btn-icon" onclick="previewFile('${escHtml(fileKey)}')" title="Preview">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>` : ''}
                    <button class="btn-icon" onclick="downloadFile('${escHtml(fileKey)}')" title="Download">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="error-msg">${escHtml(err.message)}</td></tr>`;
    }
}

function renderBreadcrumbs(prefix) {
    const container = document.getElementById('breadcrumbs');
    let html = `<a href="#" onclick="navigateTo('')" class="breadcrumb-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        Root
    </a>`;
    if (prefix) {
        const parts = prefix.replace(/\/$/, '').split('/');
        let path = '';
        parts.forEach((part, i) => {
            path += part + '/';
            const isLast = i === parts.length - 1;
            html += `<span class="breadcrumb-sep">/</span>`;
            if (isLast) {
                html += `<span class="breadcrumb-current">${escHtml(part)}</span>`;
            } else {
                const p = path;
                html += `<a href="#" onclick="navigateTo('${escHtml(p)}')" class="breadcrumb-link">${escHtml(part)}</a>`;
            }
        });
    }
    container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// File Download & Preview
// ---------------------------------------------------------------------------
function downloadFile(key) {
    const url = '/api/s3/download?key=' + encodeURIComponent(key);
    const a = document.createElement('a');
    a.href = url;
    a.download = key.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function previewFile(key) {
    // Highlight the file row
    document.querySelectorAll('#file-tbody tr').forEach(tr => tr.classList.remove('file-previewing'));
    const row = document.querySelector(`tr[data-file-key="${CSS.escape(key)}"]`);
    if (row) row.classList.add('file-previewing');
    window._previewKey = key;

    const url = '/api/s3/preview?key=' + encodeURIComponent(key);
    const ext = key.split('.').pop().toLowerCase();
    const imageExts = ['png','jpg','jpeg','gif','bmp','svg','webp','ico'];

    if (imageExts.includes(ext)) {
        showPreviewPanel(key.split('/').pop(), null, ext, url);
        return;
    }
    if (ext === 'pdf') {
        showPreviewPanel(key.split('/').pop(), null, ext, url);
        return;
    }
    // Text preview
    fetch(url)
        .then(r => { if (!r.ok) throw new Error('Failed to load file'); return r.text(); })
        .then(text => showPreviewPanel(key.split('/').pop(), text, ext, url))
        .catch(err => toast(err.message, 'error'));
}

function showPreviewPanel(filename, content, ext, url) {
    let panel = document.getElementById('preview-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'preview-panel';
        panel.className = 'preview-panel';
        panel.innerHTML = `
            <div class="upload-console-resize" id="preview-panel-resize"></div>
            <div class="upload-console-header">
                <div class="preview-title-bar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span class="preview-label">Preview</span>
                    <span class="preview-filename-badge" id="preview-filename"></span>
                </div>
                <div class="upload-console-actions">
                    <button class="upload-console-btn" onclick="downloadFile(window._previewKey)" title="Download">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                    <button class="upload-console-btn" onclick="togglePreviewMinimize()" title="Minimize">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    <button class="upload-console-btn" onclick="togglePreviewMaximize()" title="Maximize">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    </button>
                    <button class="upload-console-btn" onclick="closePreviewPanel()" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <div id="preview-body" class="preview-panel-body"></div>`;
        document.body.appendChild(panel);
        // Resize handler
        initPreviewResize();
    }
    window._previewKey = filename;
    document.getElementById('preview-filename').textContent = filename;
    const body = document.getElementById('preview-body');
    const imageExts = ['png','jpg','jpeg','gif','bmp','svg','webp','ico'];

    if (imageExts.includes(ext)) {
        body.innerHTML = `<img src="${url}" alt="${escHtml(filename)}" class="preview-image">`;
    } else if (ext === 'pdf') {
        body.innerHTML = `<iframe src="${url}" class="preview-iframe"></iframe>`;
    } else {
        // Text content with line numbers
        const lines = content.split('\n');
        const numbered = lines.map((line, i) => {
            const num = String(i + 1).padStart(4, ' ');
            return `<span class="line-num">${num}</span>${escHtml(line)}`;
        }).join('\n');
        body.innerHTML = `<pre class="preview-code">${numbered}</pre>`;
    }
    panel.style.display = '';
    panel.classList.remove('minimized', 'maximized');
}

function closePreviewPanel() {
    const panel = document.getElementById('preview-panel');
    if (panel) {
        panel.style.display = 'none';
        panel.classList.remove('minimized', 'maximized');
        panel.style.height = '';
    }
    document.querySelectorAll('#file-tbody tr').forEach(tr => tr.classList.remove('file-previewing'));
}

function togglePreviewMinimize() {
    const el = document.getElementById('preview-panel');
    if (el.classList.contains('minimized')) {
        el.classList.remove('minimized');
    } else {
        el.classList.remove('maximized');
        el.classList.add('minimized');
    }
}

function togglePreviewMaximize() {
    const el = document.getElementById('preview-panel');
    if (el.classList.contains('maximized')) {
        el.classList.remove('maximized');
    } else {
        el.classList.remove('minimized');
        el.classList.add('maximized');
    }
}

function initPreviewResize() {
    let startY, startH, panel;
    const handle = document.getElementById('preview-panel-resize');
    if (!handle) return;
    handle.addEventListener('mousedown', function(e) {
        panel = document.getElementById('preview-panel');
        panel.classList.remove('minimized', 'maximized');
        panel.style.transition = 'none';
        startY = e.clientY;
        startH = panel.offsetHeight;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onStop);
        e.preventDefault();
    });
    function onDrag(e) {
        const newH = Math.min(Math.max(startH + (startY - e.clientY), 80), window.innerHeight * 0.8);
        panel.style.height = newH + 'px';
    }
    function onStop() {
        panel.style.transition = '';
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onStop);
    }
}

// ---------------------------------------------------------------------------
// File Upload
// ---------------------------------------------------------------------------
function triggerUpload() {
    document.getElementById('file-input').click();
}

function triggerFolderUpload() {
    document.getElementById('folder-input').click();
}

function handleFileSelect(input) {
    if (input.files.length) uploadFiles(Array.from(input.files));
    input.value = '';
}

function handleFolderSelect(input) {
    if (input.files.length) uploadFiles(Array.from(input.files), true);
    input.value = '';
}

function uploadFiles(files, isFolder) {
    const formData = new FormData();
    formData.append('prefix', state.currentPrefix);
    files.forEach(f => {
        formData.append('files', f);
        const relativePath = isFolder ? f.webkitRelativePath : f.name;
        formData.append('path_' + f.name, relativePath);
    });

    // Show progress bar
    const progressEl = document.getElementById('upload-progress');
    const statusEl = document.getElementById('upload-status');
    const percentEl = document.getElementById('upload-percent');
    const fillEl = document.getElementById('progress-fill');
    progressEl.style.display = '';
    statusEl.textContent = `Uploading ${files.length} file(s)...`;
    percentEl.textContent = '0%';
    fillEl.style.width = '0%';

    // Open upload console and log details
    openUploadConsole();
    const targetPath = 's3://' + state.s3Bucket + '/' + (state.currentPrefix || '');
    consoleLog('info', `Starting upload of ${files.length} file(s) to ${targetPath}`);
    files.forEach(f => {
        const relativePath = isFolder ? f.webkitRelativePath : f.name;
        consoleLog('info', `  Queued: ${relativePath} (${formatSize(f.size)})`);
    });

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/s3/upload');
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            percentEl.textContent = pct + '%';
            fillEl.style.width = pct + '%';
            if (pct === 100) {
                statusEl.textContent = 'Finalizing...';
                consoleLog('info', 'Transfer complete, waiting for server confirmation...');
            }
        }
    };
    xhr.onload = function() {
        progressEl.style.display = 'none';
        if (xhr.status === 200) {
            try {
                const result = JSON.parse(xhr.responseText);
                consoleLog('success', `Upload complete: ${result.keys.length} file(s) uploaded successfully`);
                result.keys.forEach(k => consoleLog('success', `  Uploaded: s3://${state.s3Bucket}/${k}`));
            } catch {
                consoleLog('success', `Upload complete: ${files.length} file(s) uploaded successfully`);
            }
            toast(`Uploaded ${files.length} file(s) successfully`, 'success');
            navigateTo(state.currentPrefix);
        } else {
            try {
                const err = JSON.parse(xhr.responseText);
                consoleLog('error', `Upload failed: ${err.error || 'Unknown error'}`);
                toast(err.error || 'Upload failed', 'error');
            } catch {
                consoleLog('error', 'Upload failed: Unknown error');
                toast('Upload failed', 'error');
            }
        }
    };
    xhr.onerror = function() {
        progressEl.style.display = 'none';
        consoleLog('error', 'Upload failed: Network error');
        toast('Upload failed — network error', 'error');
    };
    xhr.send(formData);
}

// Drag and drop
document.addEventListener('DOMContentLoaded', function() {
    const browserView = document.getElementById('view-browser');
    const dropZone = document.getElementById('drop-zone');
    let dragCounter = 0;

    browserView.addEventListener('dragenter', function(e) {
        e.preventDefault();
        dragCounter++;
        dropZone.style.display = '';
    });

    browserView.addEventListener('dragleave', function(e) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) { dropZone.style.display = 'none'; dragCounter = 0; }
    });

    browserView.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('active');
    });

    browserView.addEventListener('drop', function(e) {
        e.preventDefault();
        dragCounter = 0;
        dropZone.style.display = 'none';
        dropZone.classList.remove('active');
        if (e.dataTransfer.files.length) {
            uploadFiles(Array.from(e.dataTransfer.files));
        }
    });
});

// ---------------------------------------------------------------------------
// Create Folder
// ---------------------------------------------------------------------------
function showCreateFolderModal() {
    document.getElementById('new-folder-name').value = '';
    document.getElementById('modal-create-folder').style.display = '';
    document.getElementById('new-folder-name').focus();
}

async function doCreateFolder(e) {
    e.preventDefault();
    const name = document.getElementById('new-folder-name').value.trim();
    try {
        await api('POST', '/api/s3/create-folder', { prefix: state.currentPrefix, name });
        closeModal('modal-create-folder');
        toast(`Folder '${name}' created`, 'success');
        navigateTo(state.currentPrefix);
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function loadProfile() {
    if (!state.user) return;
    document.getElementById('profile-username').textContent = state.user.username;
    document.getElementById('profile-role').textContent = state.user.role;
}

async function doChangePassword(e) {
    e.preventDefault();
    const errEl = document.getElementById('profile-pw-error');
    const successEl = document.getElementById('profile-pw-success');
    errEl.style.display = 'none';
    successEl.style.display = 'none';
    const oldPw = document.getElementById('profile-old-pw').value;
    const newPw = document.getElementById('profile-new-pw').value;
    const confirmPw = document.getElementById('profile-confirm-pw').value;
    if (newPw !== confirmPw) {
        errEl.textContent = 'Passwords do not match';
        errEl.style.display = '';
        return;
    }
    try {
        await api('POST', '/api/change-password', { old_password: oldPw, new_password: newPw });
        successEl.textContent = 'Password changed successfully';
        successEl.style.display = '';
        document.getElementById('profile-old-pw').value = '';
        document.getElementById('profile-new-pw').value = '';
        document.getElementById('profile-confirm-pw').value = '';
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
    }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
async function loadAdminUsers() {
    const tbody = document.getElementById('admin-users-tbody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">Loading...</td></tr>';
    try {
        const res = await api('GET', '/api/admin/users');
        tbody.innerHTML = res.users.map(u => `<tr>
            <td><strong>${escHtml(u.username)}</strong></td>
            <td>${escHtml(u.role)}</td>
            <td><div class="user-folders">${u.allowed_folders.map(f => `<span class="folder-tag">${escHtml(f)}</span>`).join('')}</div></td>
            <td><span class="status-badge ${u.must_change_password ? 'status-pending' : 'status-active'}">${u.must_change_password ? 'Pending' : 'Active'}</span></td>
            <td><div class="action-btns">
                <button class="btn-icon" title="Edit" onclick='showEditUserModal(${JSON.stringify(u).replace(/'/g, "&#39;")})'>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon delete" title="Delete" onclick="doDeleteUser('${escHtml(u.username)}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div></td>
        </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="error-msg">${escHtml(err.message)}</td></tr>`;
    }
}

// ---------------------------------------------------------------------------
// Admin Folder Checkbox Helpers
// ---------------------------------------------------------------------------
async function loadFoldersForAdmin(mode, selectedFolders) {
    selectedFolders = selectedFolders || [];
    const listEl = document.getElementById(mode + '-user-folder-list');
    const allAccessEl = document.getElementById(mode + '-user-all-access');
    listEl.innerHTML = '<div class="folder-loading">Loading folders...</div>';
    allAccessEl.checked = selectedFolders.includes('*');

    let folders = [];
    try {
        const res = await api('GET', '/api/s3/folders');
        folders = res.folders || [];
    } catch {
        // If S3 is not configured, show empty list
    }

    // Merge in any selected folders not already in the list
    selectedFolders.forEach(f => {
        if (f !== '*') {
            const normalized = f.endsWith('/') ? f : f + '/';
            if (!folders.includes(normalized)) folders.push(normalized);
        }
    });

    if (folders.length === 0) {
        listEl.innerHTML = '<div class="folder-loading">No folders found in bucket</div>';
    } else {
        listEl.innerHTML = folders.map(f => {
            const clean = f.replace(/\/$/, '');
            const isChecked = selectedFolders.includes(f) || selectedFolders.includes(clean) || selectedFolders.includes('*');
            return `<label class="folder-checkbox-item">
                <input type="checkbox" value="${escHtml(f)}" ${isChecked ? 'checked' : ''}>
                <span>${escHtml(f)}</span>
            </label>`;
        }).join('');
    }

    // Disable individual checkboxes if all-access is checked
    if (allAccessEl.checked) {
        listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = true; cb.checked = true; });
    }
}

function toggleAllAccess(mode) {
    const allAccessEl = document.getElementById(mode + '-user-all-access');
    const listEl = document.getElementById(mode + '-user-folder-list');
    const checkboxes = listEl.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.disabled = allAccessEl.checked;
        if (allAccessEl.checked) cb.checked = true;
    });
}

function getSelectedFolders(mode) {
    const allAccessEl = document.getElementById(mode + '-user-all-access');
    if (allAccessEl.checked) return ['*'];
    const listEl = document.getElementById(mode + '-user-folder-list');
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checked).map(cb => cb.value);
}

async function createFolderFromAdmin(mode) {
    const inputEl = document.getElementById(mode + '-user-new-folder');
    const name = inputEl.value.trim().replace(/[^\w\-. ]/g, '');
    if (!name) { toast('Enter a folder name', 'error'); return; }
    try {
        await api('POST', '/api/s3/create-folder', { prefix: '', name });
        toast(`Folder '${name}' created`, 'success');
        inputEl.value = '';
        // Reload folder list preserving current selections
        const currentSelected = getSelectedFolders(mode);
        currentSelected.push(name + '/');
        await loadFoldersForAdmin(mode, currentSelected);
    } catch (err) {
        toast(err.message, 'error');
    }
}

function showAddUserModal() {
    document.getElementById('add-user-name').value = '';
    document.getElementById('add-user-pw').value = '';
    document.getElementById('add-user-role').value = 'user';
    document.getElementById('add-user-error').style.display = 'none';
    document.getElementById('modal-add-user').style.display = '';
    document.getElementById('add-user-name').focus();
    loadFoldersForAdmin('add', []);
}

async function doAddUser(e) {
    e.preventDefault();
    const errEl = document.getElementById('add-user-error');
    errEl.style.display = 'none';
    const username = document.getElementById('add-user-name').value.trim();
    const password = document.getElementById('add-user-pw').value;
    const role = document.getElementById('add-user-role').value;
    const allowed_folders = getSelectedFolders('add');
    try {
        await api('POST', '/api/admin/users', { username, password, role, allowed_folders });
        closeModal('modal-add-user');
        toast(`User '${username}' created`, 'success');
        loadAdminUsers();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
    }
}

function showEditUserModal(user) {
    document.getElementById('edit-user-title').textContent = user.username;
    document.getElementById('edit-user-name').value = user.username;
    document.getElementById('edit-user-role').value = user.role;
    document.getElementById('edit-user-reset-pw').value = '';
    document.getElementById('edit-user-error').style.display = 'none';
    document.getElementById('modal-edit-user').style.display = '';
    loadFoldersForAdmin('edit', user.allowed_folders || []);
}

async function doEditUser(e) {
    e.preventDefault();
    const errEl = document.getElementById('edit-user-error');
    errEl.style.display = 'none';
    const username = document.getElementById('edit-user-name').value;
    const role = document.getElementById('edit-user-role').value;
    const allowed_folders = getSelectedFolders('edit');
    const resetPw = document.getElementById('edit-user-reset-pw').value;
    const body = { role, allowed_folders };
    if (resetPw) body.reset_password = resetPw;
    try {
        await api('PUT', '/api/admin/users/' + encodeURIComponent(username), body);
        closeModal('modal-edit-user');
        toast(`User '${username}' updated`, 'success');
        loadAdminUsers();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
    }
}

async function doDeleteUser(username) {
    const ok = await showConfirm({
        title: 'Delete User',
        message: `Are you sure you want to delete user '${username}'? This action cannot be undone.`,
        confirmText: 'Delete',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await api('DELETE', '/api/admin/users/' + encodeURIComponent(username));
        toast(`User '${username}' deleted`, 'success');
        loadAdminUsers();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ---------------------------------------------------------------------------
// Upload Console
// ---------------------------------------------------------------------------
function openUploadConsole() {
    const consoleEl = document.getElementById('upload-console');
    const body = document.getElementById('upload-console-body');
    consoleEl.style.display = '';
    consoleEl.classList.remove('minimized');
    updateConsoleButton(true);
    // Add separator if there are existing logs
    if (body.children.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'console-separator';
        const now = new Date();
        sep.textContent = '--- New Transfer Session ' + now.toLocaleTimeString('en-US', { hour12: false }) + ' ---';
        body.appendChild(sep);
    }
}

function consoleLog(type, msg) {
    const body = document.getElementById('upload-console-body');
    const consoleEl = document.getElementById('upload-console');
    // Always log even if hidden, so logs persist
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const tagLabel = type === 'success' ? 'OK' : type === 'error' ? 'ERR' : type === 'warn' ? 'WARN' : 'INFO';
    const line = document.createElement('div');
    line.className = 'console-line ' + type;
    line.innerHTML = `<span class="console-time">${time}</span><span class="console-tag ${type}">${tagLabel}</span><span class="console-msg">${escHtml(msg)}</span>`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    // Show console if hidden
    if (consoleEl.style.display === 'none') {
        consoleEl.style.display = '';
        consoleEl.classList.remove('minimized');
        updateConsoleButton(true);
    }
    // Update badge count
    window._consoleLogCount = (window._consoleLogCount || 0) + 1;
}

function closeUploadConsole() {
    const el = document.getElementById('upload-console');
    el.style.display = 'none';
    el.classList.remove('minimized', 'maximized');
    el.style.height = '';
    updateConsoleButton(false);
}

function toggleUploadConsole() {
    const el = document.getElementById('upload-console');
    if (el.style.display === 'none') {
        el.style.display = '';
        el.classList.remove('minimized');
        updateConsoleButton(true);
        // Scroll to bottom
        const body = document.getElementById('upload-console-body');
        body.scrollTop = body.scrollHeight;
    } else {
        closeUploadConsole();
    }
}

function updateConsoleButton(active) {
    const btn = document.getElementById('btn-toggle-console');
    if (btn) btn.classList.toggle('active', active);
}

function clearConsoleLogs() {
    document.getElementById('upload-console-body').innerHTML = '';
    window._consoleLogCount = 0;
}

function toggleConsoleMinimize() {
    const el = document.getElementById('upload-console');
    if (el.classList.contains('minimized')) {
        el.classList.remove('minimized');
    } else {
        el.classList.remove('maximized');
        el.classList.add('minimized');
    }
}

function toggleConsoleMaximize() {
    const el = document.getElementById('upload-console');
    if (el.classList.contains('maximized')) {
        el.classList.remove('maximized');
    } else {
        el.classList.remove('minimized');
        el.classList.add('maximized');
    }
}

// Drag-to-resize console
(function() {
    let startY, startH, consoleEl;
    const handle = document.getElementById('upload-console-resize');
    if (!handle) return;
    handle.addEventListener('mousedown', function(e) {
        consoleEl = document.getElementById('upload-console');
        consoleEl.classList.remove('minimized', 'maximized');
        consoleEl.style.transition = 'none';
        startY = e.clientY;
        startH = consoleEl.offsetHeight;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onStop);
        e.preventDefault();
    });
    function onDrag(e) {
        const newH = Math.min(Math.max(startH + (startY - e.clientY), 80), window.innerHeight * 0.8);
        consoleEl.style.height = newH + 'px';
    }
    function onStop() {
        consoleEl.style.transition = '';
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onStop);
    }
})();

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// ---------------------------------------------------------------------------
// Custom Confirm Dialog (replaces native confirm/alert)
// ---------------------------------------------------------------------------
let _confirmResolve = null;

function showConfirm({ title, message, confirmText, cancelText, type }) {
    return new Promise(resolve => {
        _confirmResolve = resolve;
        document.getElementById('confirm-title').textContent = title || 'Confirm';
        document.getElementById('confirm-message').textContent = message || '';
        const okBtn = document.getElementById('confirm-ok-btn');
        okBtn.textContent = confirmText || 'Confirm';
        okBtn.className = type === 'danger' ? 'btn btn-danger-filled' : 'btn btn-primary';
        document.getElementById('confirm-cancel-btn').textContent = cancelText || 'Cancel';
        // Icon
        const iconEl = document.getElementById('confirm-icon');
        const iconType = type || 'info';
        iconEl.className = 'confirm-icon ' + iconType;
        const icons = {
            danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
            warning: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };
        iconEl.innerHTML = icons[iconType] || icons.info;
        document.getElementById('modal-confirm').style.display = '';
    });
}

function resolveConfirm(result) {
    document.getElementById('modal-confirm').style.display = 'none';
    if (_confirmResolve) {
        _confirmResolve(result);
        _confirmResolve = null;
    }
}

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast toast-' + (type || 'success');
    el.style.display = '';
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
         + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);
