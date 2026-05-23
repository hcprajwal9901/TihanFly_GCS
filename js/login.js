/* ─────────────────────────────────────────
   TiHANFly GCS — WebSocket-Powered Login Logic
   All user data stored in C++ backend / SQLite DB
   ───────────────────────────────────────── */

// ═══════════════════════════════════════════
//  CONFIG — Change this to your server address
// ═══════════════════════════════════════════
const WS_URL = 'ws://localhost:8080';  // ← Change to your server IP when deployed
                                        //   e.g. 'ws://192.168.1.100:8080'
                                        //   e.g. 'wss://tihanfly.iith.ac.in:8080'

// ═══════════════════════════════════════════
//  WEBSOCKET MANAGER
//  Auto-reconnect, message queue, request-response
// ═══════════════════════════════════════════
class TiHANSocket {
    constructor(url) {
        this.url       = url;
        this.ws        = null;
        this.connected = false;
        this.queue     = [];       // messages queued while disconnected
        this.handlers  = {};       // type → [callback, ...]
        this.connect();
    }

    connect() {
        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                this.connected = true;
                console.log('[WS] Connected to TiHANFly backend');
                updateConnectionStatus(true);
                // Flush queued messages
                while (this.queue.length) this.ws.send(this.queue.shift());
                // Start heartbeat
                this.heartbeat = setInterval(() => this.send({type:'ping'}), 25000);
            };

            this.ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    console.log('[WS] ←', msg.type, msg);
                    const cbs = this.handlers[msg.type] || [];
                    cbs.forEach(cb => cb(msg));
                    // Global error display
                    if (msg.type === 'error') showAlert('⚠  ' + msg.message);
                } catch(err) { console.error('[WS] Parse error', err); }
            };

            this.ws.onclose = () => {
                this.connected = false;
                clearInterval(this.heartbeat);
                updateConnectionStatus(false);
                console.log('[WS] Disconnected — reconnecting in 3s...');
                setTimeout(() => this.connect(), 3000);
            };

            this.ws.onerror = (e) => {
                console.error('[WS] Error', e);
            };
        } catch(e) {
            console.error('[WS] Connection failed', e);
            setTimeout(() => this.connect(), 3000);
        }
    }

    send(obj) {
        const msg = JSON.stringify(obj);
        if (this.connected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(msg);
        } else {
            this.queue.push(msg);
        }
    }

    on(type, callback) {
        if (!this.handlers[type]) this.handlers[type] = [];
        this.handlers[type].push(callback);
        return this; // chainable
    }

    off(type) { delete this.handlers[type]; }
}

// ─── Global socket instance ───
const socket = new TiHANSocket(WS_URL);

// ─── Connection status indicator in footer ───
function updateConnectionStatus(online) {
    const dot  = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    if (!dot || !text) return;
    if (online) {
        dot.style.background    = '#00d084';
        dot.style.boxShadow     = '0 0 6px #00d084';
        text.textContent        = 'SYSTEMS ONLINE';
    } else {
        dot.style.background    = '#ff4757';
        dot.style.boxShadow     = '0 0 6px #ff4757';
        text.textContent        = 'RECONNECTING...';
    }
}

// ═══════════════════════════════════════════
//  TAB SWITCHER
// ═══════════════════════════════════════════
function switchTab(tab) {
    ['tabLogin','tabSignup','tabAdmin'].forEach(id =>
        document.getElementById(id).classList.remove('active'));
    ['panelLogin','panelSignup','panelAdmin','panelDashboard'].forEach(id =>
        document.getElementById(id).classList.remove('active'));
    clearAlert();

    const card = document.getElementById('mainCard');

    if (tab === 'login') {
        document.getElementById('tabLogin').classList.add('active');
        document.getElementById('panelLogin').classList.add('active');
        card.classList.remove('dashboard-mode');
    } else if (tab === 'signup') {
        document.getElementById('tabSignup').classList.add('active');
        document.getElementById('panelSignup').classList.add('active');
        card.classList.remove('dashboard-mode');
    } else if (tab === 'admin') {
        document.getElementById('tabAdmin').classList.add('active');
        document.getElementById('panelAdmin').classList.add('active');
        card.classList.remove('dashboard-mode');
    } else if (tab === 'dashboard') {
        document.getElementById('tabAdmin').classList.add('active');
        document.getElementById('panelDashboard').classList.add('active');
        card.classList.add('dashboard-mode');
        requestUsers();
    }
}

// ═══════════════════════════════════════════
//  ALERT
// ═══════════════════════════════════════════
function showAlert(msg, type = 'error') {
    const el = document.getElementById('authAlert');
    el.textContent = msg;
    el.className = `alert ${type}`;
    el.style.display = 'block';
}
function clearAlert() { document.getElementById('authAlert').style.display = 'none'; }

// ═══════════════════════════════════════════
//  PASSWORD STRENGTH
// ═══════════════════════════════════════════
function updateStrength(val) {
    const segs = ['seg1','seg2','seg3','seg4'].map(id => document.getElementById(id));
    segs.forEach(s => s.className = 'seg');
    let score = 0;
    if (val.length >= 8)          score++;
    if (/[A-Z]/.test(val))        score++;
    if (/[0-9]/.test(val))        score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const cls = score <= 1 ? 'weak' : score <= 2 ? 'ok' : 'strong';
    for (let i = 0; i < score; i++) segs[i].classList.add(cls);
}

// ═══════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════
function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPassword').value;

    if (!email || !pass)      { showAlert('⚠  All fields are required.'); return; }
    if (!email.includes('@')) { showAlert('⚠  Enter a valid email address.'); return; }

    const btn = document.querySelector('#panelLogin .btn-submit');
    setBtn(btn, 'Authenticating...', true);

    // One-time handlers for login response
    socket.on('login_success', (msg) => {
        socket.off('login_success');
        socket.off('login_error');
        showAlert('✓  ' + msg.message, 'success');
        setTimeout(() => { window.location.href = 'MainWindow.html'; }, 1000);
    });

    socket.on('login_error', (msg) => {
        socket.off('login_success');
        socket.off('login_error');
        showAlert('⚠  ' + msg.message);
        setBtn(btn, 'Log In', false);
    });

    socket.send({ type: 'login', email, password: pass });
}

// ═══════════════════════════════════════════
//  SIGNUP
// ═══════════════════════════════════════════
function handleSignup() {
    const first   = document.getElementById('signupFirst').value.trim();
    const last    = document.getElementById('signupLast').value.trim();
    const email   = document.getElementById('signupEmail').value.trim();
    const pass    = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;
    const terms   = document.getElementById('termsCheck').checked;

    if (!first||!last||!email||!pass||!confirm) { showAlert('⚠  Please fill in all fields.'); return; }
    if (!email.includes('@'))  { showAlert('⚠  Enter a valid institutional email.'); return; }
    if (pass.length < 8)       { showAlert('⚠  Password must be at least 8 characters.'); return; }
    if (pass !== confirm)      { showAlert('⚠  Passwords do not match.'); return; }
    if (!terms)                { showAlert('⚠  You must accept the Terms of Service.'); return; }

    const btn = document.querySelector('#panelSignup .btn-submit');
    setBtn(btn, 'Registering...', true);

    // Listen for signup responses
    socket.on('signup_pending', (msg) => {
        socket.off('signup_pending');
        socket.off('signup_error');

        // Show a waiting UI
        showAlert('⏳  ' + msg.message, 'success');
        setBtn(btn, 'Waiting for Approval...', true);

        // Now wait for real-time approval/rejection
        socket.on('account_approved', (approvalMsg) => {
            socket.off('account_approved');
            socket.off('account_rejected');
            showApprovalNotification('approved', approvalMsg.message);
            setBtn(btn, 'Create Account', false);
        });

        socket.on('account_rejected', (rejMsg) => {
            socket.off('account_approved');
            socket.off('account_rejected');
            showApprovalNotification('rejected', rejMsg.message);
            setBtn(btn, 'Create Account', false);
        });
    });

    socket.on('signup_error', (msg) => {
        socket.off('signup_pending');
        socket.off('signup_error');
        showAlert('⚠  ' + msg.message);
        setBtn(btn, 'Create Account', false);
    });

    socket.send({ type: 'signup', firstName: first, lastName: last, email, password: pass });
}

// ─── Full-screen approval notification ───
function showApprovalNotification(result, message) {
    const isApproved = result === 'approved';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(13,17,23,0.88);
        display:flex;align-items:center;justify-content:center;
        z-index:9999;animation:fadeIn 0.3s ease;
    `;
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:48px 40px;text-align:center;
                    max-width:420px;width:90%;box-shadow:0 40px 80px rgba(0,0,0,0.3)">
            <div style="font-size:56px;margin-bottom:16px">${isApproved ? '✅' : '❌'}</div>
            <div style="font-size:22px;font-weight:700;color:${isApproved?'#00875a':'#d63031'};
                        margin-bottom:10px">
                ${isApproved ? 'Account Approved!' : 'Registration Rejected'}
            </div>
            <div style="font-size:14px;color:#8892a4;margin-bottom:28px;line-height:1.6">
                ${message}
            </div>
            ${isApproved ? `
            <button onclick="this.closest('div').parentElement.remove();switchTab('login')"
                style="background:#e6007e;color:#fff;border:none;padding:13px 32px;
                       border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">
                Proceed to Login →
            </button>` : `
            <button onclick="this.closest('div').parentElement.remove()"
                style="background:#f0f2f7;color:#1a1f2e;border:none;padding:13px 32px;
                       border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">
                Close
            </button>`}
        </div>
    `;
    document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════
//  ADMIN LOGIN
// ═══════════════════════════════════════════
function handleAdminLogin() {
    const user = document.getElementById('adminUser').value.trim();
    const pass = document.getElementById('adminPass').value;
    if (!user || !pass) { showAlert('⚠  Both fields are required.'); return; }

    const btn = document.getElementById('adminSubmitBtn');
    setBtn(btn, 'Verifying...', true);

    socket.on('admin_login_success', () => {
        socket.off('admin_login_success');
        socket.off('admin_login_error');
        clearAlert();
        setBtn(btn, 'Access Admin Panel', false);
        switchTab('dashboard');

        // Register real-time listener for new signups
        socket.on('new_signup', handleNewSignupNotification);
    });

    socket.on('admin_login_error', (msg) => {
        socket.off('admin_login_success');
        socket.off('admin_login_error');
        showAlert('⚠  ' + msg.message);
        setBtn(btn, 'Access Admin Panel', false);
    });

    socket.send({ type: 'admin_login', username: user, password: pass });
}

// ─── Admin: real-time new signup notification ───
function handleNewSignupNotification(msg) {
    showToast(
        `🆕 New Registration Request`,
        `${msg.firstName} ${msg.lastName} (${msg.email}) wants to join.`,
        'info',
        () => {
            // Scroll to and highlight the user in the table
            renderDashboard();
            setTimeout(() => highlightUser(msg.userId), 300);
        }
    );
    renderDashboard(); // Refresh table
}

// ─── Admin: approve/reject from table ───
function approveUser(userId, sessionId) {
    if (!confirm('Approve this user? They will receive real-time login access.')) return;
    socket.on('admin_action_done', (msg) => {
        socket.off('admin_action_done');
        showToast('✅ Approved', 'User has been notified and can now log in.', 'success');
        renderDashboard();
    });
    socket.send({ type: 'admin_approve', userId, sessionId, note: 'Approved by TiHAN admin.' });
}

function rejectUser(userId, sessionId) {
    const reason = prompt('Rejection reason (shown to user):') || 'Not authorized for testbed access.';
    if (reason === null) return;
    socket.on('admin_action_done', (msg) => {
        socket.off('admin_action_done');
        showToast('❌ Rejected', 'User has been notified.', 'error');
        renderDashboard();
    });
    socket.send({ type: 'admin_reject', userId, sessionId, reason });
}

// ─── Admin logout ───
function handleAdminLogout() {
    socket.off('new_signup');
    document.getElementById('adminUser').value = '';
    document.getElementById('adminPass').value = '';
    switchTab('admin');
}

// ═══════════════════════════════════════════
//  DASHBOARD — fetch and render
// ═══════════════════════════════════════════
function requestUsers() {
    socket.on('users_list', (msg) => {
        socket.off('users_list');
        renderUsers(msg.users || []);
    });
    socket.send({ type: 'admin_get_users' });
}

function renderDashboard() { requestUsers(); }

function renderUsers(users) {
    const query    = (document.getElementById('dashSearch')?.value || '').toLowerCase();
    const tbody    = document.getElementById('tableBody');
    const empty    = document.getElementById('dashEmpty');
    const wrap     = document.getElementById('dashTableWrap');
    const today    = new Date().toDateString();

    // Stats
    document.getElementById('dstatTotal').textContent    = users.length;
    document.getElementById('dstatActive').textContent   = users.filter(u=>u.status==='active').length;
    document.getElementById('dstatInactive').textContent = users.filter(u=>u.status==='inactive'||u.status==='rejected').length;
    document.getElementById('dstatToday').textContent    = users.filter(u=>u.registeredAt && new Date(u.registeredAt).toDateString()===today).length;
    document.getElementById('dashUserCount').textContent = users.length;

    const filtered = users.filter(u =>
        ((u.firstName||'')+(u.lastName||'')).toLowerCase().includes(query) ||
        (u.email||'').toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        wrap.style.display  = 'none';
        empty.style.display = 'block';
        return;
    }
    wrap.style.display  = 'block';
    empty.style.display = 'none';

    tbody.innerHTML = filtered.map((u, i) => {
        const isPending = u.status === 'pending';
        const statusClass = isPending ? 'pending' : u.status;
        const statusLabel = isPending ? '⏳ Pending' : u.status === 'active' ? 'Active' : 'Disabled';

        return `
        <tr id="user-${u.id}">
            <td>
                <div class="td-user">
                    <div class="td-avatar">${(u.firstName||'?')[0]}${(u.lastName||'?')[0]}</div>
                    <div>
                        <div class="td-name">${escHtml(u.firstName)} ${escHtml(u.lastName)}</div>
                        <div class="td-sub">${escHtml(u.email)}
                            <span class="provider-badge ${u.provider}">${u.provider==='google'?'G':'✉'}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td><span class="td-id">…${escHtml(u.id).slice(-10)}</span></td>
            <td>
                <span class="td-status ${statusClass}" style="${isPending?'background:rgba(255,165,2,0.1);color:#ffa502;border-color:rgba(255,165,2,0.3)':''}">
                    <span class="td-dot ${u.status==='active'?'pulse':''}"></span>
                    ${statusLabel}
                </span>
            </td>
            <td>
                <div class="td-date">${formatDate(u.registeredAt)}</div>
                <div class="td-time">${formatTime(u.registeredAt)}</div>
            </td>
            <td>
                ${u.lastLogin
                    ? `<div class="td-date">${formatDate(u.lastLogin)}</div><div class="td-time">${formatTime(u.lastLogin)}</div>`
                    : `<span class="td-never">Never</span>`}
            </td>
            <td>
                <div class="td-actions">
                    ${isPending ? `
                        <button class="btn-tbl approve" onclick="approveUser('${u.id}','${u.sessionId||''}')">✓ Approve</button>
                        <button class="btn-tbl del" onclick="rejectUser('${u.id}','${u.sessionId||''}')">✗ Reject</button>
                    ` : `
                        <button class="btn-tbl" onclick="toggleUserStatus('${u.id}')">
                            ${u.status==='active' ? 'Disable' : 'Enable'}
                        </button>
                        <button class="btn-tbl del" onclick="deleteUser('${u.id}')">Delete</button>
                    `}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function highlightUser(userId) {
    const row = document.getElementById('user-'+userId);
    if (row) {
        row.style.background = 'rgba(230,0,126,0.06)';
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => row.style.background = '', 3000);
    }
}

function toggleUserStatus(userId) {
    socket.on('toggle_done', (msg) => {
        socket.off('toggle_done');
        renderDashboard();
    });
    socket.send({ type: 'admin_toggle_status', userId });
}

function deleteUser(userId) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    socket.on('delete_done', (msg) => {
        socket.off('delete_done');
        renderDashboard();
    });
    socket.send({ type: 'admin_delete_user', userId });
}

// ═══════════════════════════════════════════
//  FORGOT PASSWORD
// ═══════════════════════════════════════════
function showForgot(e) {
    e.preventDefault();
    showAlert('📧  Password reset: Contact admin at tihan@iith.ac.in');
}

// ═══════════════════════════════════════════
//  GOOGLE SIGN-IN (kept for compatibility)
// ═══════════════════════════════════════════
let GOOGLE_CLIENT_ID = '550094782822-1q75l0qktur34aptnb9t4sd7cir07h89.apps.googleusercontent.com';

function handleGoogleLogin() {
    document.getElementById('googleModal').style.display = 'flex';
}
function closeGoogleModal() { document.getElementById('googleModal').style.display = 'none'; }
function applyClientId() { closeGoogleModal(); }

document.addEventListener('click', (e) => {
    const modal = document.getElementById('googleModal');
    if (e.target === modal) closeGoogleModal();
});

// ═══════════════════════════════════════════
//  TOAST NOTIFICATION
// ═══════════════════════════════════════════
function showToast(title, body, type = 'info', onClick = null) {
    const colors = {
        info:    '#00b4d8',
        success: '#00d084',
        error:   '#ff4757',
        warning: '#ffa502'
    };
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed;bottom:24px;right:24px;
        background:#1a1f2e;color:#fff;
        border-left:4px solid ${colors[type]||colors.info};
        border-radius:10px;padding:14px 20px;
        min-width:280px;max-width:380px;
        box-shadow:0 8px 30px rgba(0,0,0,0.35);
        z-index:99999;cursor:${onClick?'pointer':'default'};
        animation:slideInRight 0.35s cubic-bezier(0.16,1,0.3,1);
        font-family:'DM Sans',sans-serif;
    `;
    toast.innerHTML = `
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${title}</div>
        <div style="font-size:12px;color:#8892a4;line-height:1.4">${body}</div>
    `;
    if (onClick) toast.addEventListener('click', onClick);
    document.body.appendChild(toast);

    // Add animation keyframes if not present
    if (!document.getElementById('toast-styles')) {
        const s = document.createElement('style');
        s.id = 'toast-styles';
        s.textContent = `
            @keyframes slideInRight {
                from { opacity:0; transform:translateX(40px); }
                to   { opacity:1; transform:translateX(0); }
            }
            .btn-tbl.approve { border-color:rgba(0,208,132,0.35);color:#00d084; }
            .btn-tbl.approve:hover { background:rgba(0,208,132,0.08);border-color:#00d084; }
            .provider-badge {
                display:inline-block;padding:1px 5px;border-radius:3px;
                font-size:10px;font-weight:700;margin-left:4px;
            }
            .provider-badge.google { background:#4285F4;color:#fff; }
            .provider-badge.email  { background:#e6007e;color:#fff; }
        `;
        document.head.appendChild(s);
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.4s';
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════
function setBtn(btn, label, disabled) {
    btn.textContent = label;
    btn.disabled    = disabled;
    btn.style.opacity = disabled ? '0.7' : '1';
}

function escHtml(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'});
}
function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
}

// ─── Enter key support ───
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if      (document.getElementById('panelLogin').classList.contains('active'))   handleLogin();
    else if (document.getElementById('panelSignup').classList.contains('active'))  handleSignup();
    else if (document.getElementById('panelAdmin').classList.contains('active'))   handleAdminLogin();
});

// ─── HUD ticker ───
setInterval(() => {
    const lat = (17.4065 + (Math.random()-0.5)*0.0001).toFixed(4);
    const el  = document.getElementById('hudCoords');
    if (el) el.textContent = `LAT: ${lat}° N`;
}, 3000); b 
