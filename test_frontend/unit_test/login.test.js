describe('Web Authentication Panel Suite (js/login.js)', () => {
  let originalGetElementById;
  let originalQuerySelector;
  let originalQuerySelectorAll;

  beforeAll(() => {
    // Preserve setup.js custom selector guards
    originalGetElementById = document.getElementById;
    originalQuerySelector = document.querySelector;
    originalQuerySelectorAll = document.querySelectorAll;

    // Temporarily bind native JSDOM selectors to bypass auto-creation of elements
    document.getElementById = Document.prototype.getElementById.bind(document);
    document.querySelector = Document.prototype.querySelector.bind(document);
    document.querySelectorAll = Document.prototype.querySelectorAll.bind(document);

    global.WebSocket.OPEN = 1;

    // Mock HTMLCanvasElement context to avoid DOM exceptions
    HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
      drawImage: jest.fn()
    });

    // Mock location redirect using Window.prototype.location redefinition
    const mockLocation = { href: '' };
    global.mockLocation = mockLocation;
    try {
      Object.defineProperty(window.constructor.prototype, 'location', {
        writable: true,
        configurable: true,
        value: mockLocation
      });
    } catch (e) {
      // Fallback
    }

    // Mock global alert, confirm and prompt dialogs
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
    window.prompt = jest.fn().mockReturnValue('Authorized');

    // Create target DOM nodes needed during initial script load
    document.body.innerHTML = `
      <div id="mainCard"></div>
      <div id="authAlert" style="display:none"></div>
      <div id="tabLogin"></div>
      <div id="tabSignup"></div>
      <div id="tabAdmin"></div>
      <div id="panelLogin"><button class="btn-submit"></button></div>
      <div id="panelSignup"><button class="btn-submit"></button></div>
      <div id="panelAdmin"></div>
      <div id="panelDashboard"></div>
      <span class="status-dot"></span>
      <span class="status-text"></span>
      <div id="seg1"></div><div id="seg2"></div><div id="seg3"></div><div id="seg4"></div>
      <input id="loginEmail" />
      <input id="loginPassword" />
      <input id="signupFirst" />
      <input id="signupLast" />
      <input id="signupEmail" />
      <input id="signupPassword" />
      <input id="signupConfirm" />
      <input id="termsCheck" type="checkbox" />
      <input id="adminUser" />
      <input id="adminPass" />
      <button id="adminSubmitBtn"></button>
      <input id="dashSearch" />
      <div id="tableBody"></div>
      <div id="dashEmpty"></div>
      <div id="dashTableWrap"></div>
      <div id="dstatTotal">0</div>
      <div id="dstatActive">0</div>
      <div id="dstatInactive">0</div>
      <div id="dstatToday">0</div>
      <div id="dashUserCount">0</div>
      <div id="hudCoords"></div>
      <div id="googleModal" style="display:none"></div>
    `;

    // Load module script exactly once
    global.loadScript('js/login.js');
  });

  afterAll(() => {
    // Restore setup.js custom selector guards for other suites
    document.getElementById = originalGetElementById;
    document.querySelector = originalQuerySelector;
    document.querySelectorAll = originalQuerySelectorAll;

    document.body.innerHTML = '';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.mockLocation.href = '';
    
    // Clear alerts
    document.getElementById('authAlert').style.display = 'none';
    document.getElementById('authAlert').textContent = '';

    // Clear checkboxes and inputs
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('signupFirst').value = '';
    document.getElementById('signupLast').value = '';
    document.getElementById('signupEmail').value = '';
    document.getElementById('signupPassword').value = '';
    document.getElementById('signupConfirm').value = '';
    document.getElementById('termsCheck').checked = false;
    document.getElementById('adminUser').value = '';
    document.getElementById('adminPass').value = '';
  });

  describe('TiHANSocket Class & Reconnections', () => {
    it('should queue outbound payloads when offline and flush on open', () => {
      // Simulate socket offline
      socket.connected = false;
      socket.ws.readyState = 0; // CONNECTING
      socket.queue = [];

      socket.send({ type: 'test_action', payload: '123' });

      // Verify queued
      expect(socket.queue.length).toBe(1);
      expect(socket.queue[0]).toContain('test_action');

      // Setup ws.send spy
      const sendSpy = jest.spyOn(socket.ws, 'send').mockImplementation(() => {});

      // Simulate connection open (onopen callback)
      socket.connected = true;
      socket.ws.onopen();

      // Verify flushed
      expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining('test_action'));
      expect(socket.queue.length).toBe(0);

      sendSpy.mockRestore();
    });

    it('should trigger connection status dot indicator styles dynamically', () => {
      const dot = document.querySelector('.status-dot');
      const text = document.querySelector('.status-text');

      // Systems online
      socket.ws.onopen();
      expect(dot.style.background).toBe('rgb(0, 208, 132)'); // green
      expect(text.textContent).toBe('SYSTEMS ONLINE');

      // Systems offline
      socket.ws.onclose();
      expect(dot.style.background).toBe('rgb(255, 71, 87)'); // red
      expect(text.textContent).toBe('RECONNECTING...');
    });
  });

  describe('UI Tab Switches & Passwords Strength Metrics', () => {
    it('should switch panel layouts and card classes on switchTab()', () => {
      // Switch to signup
      switchTab('signup');
      expect(document.getElementById('tabSignup').classList.contains('active')).toBe(true);
      expect(document.getElementById('panelSignup').classList.contains('active')).toBe(true);
      expect(document.getElementById('mainCard').classList.contains('dashboard-mode')).toBe(false);

      // Switch to login
      switchTab('login');
      expect(document.getElementById('tabLogin').classList.contains('active')).toBe(true);
      expect(document.getElementById('panelLogin').classList.contains('active')).toBe(true);

      // Switch to admin
      switchTab('admin');
      expect(document.getElementById('tabAdmin').classList.contains('active')).toBe(true);
      expect(document.getElementById('panelAdmin').classList.contains('active')).toBe(true);
    });

    it('should classify password complexity levels accurately', () => {
      // Weak password
      updateStrength('12345');
      expect(document.getElementById('seg1').className).toBe('seg weak');
      expect(document.getElementById('seg2').className).toBe('seg');

      // Medium password (score 2: length >= 8 and has digits, no uppercase)
      updateStrength('pass1234');
      expect(document.getElementById('seg1').className).toBe('seg ok');
      expect(document.getElementById('seg2').className).toBe('seg ok');
      expect(document.getElementById('seg3').className).toBe('seg');
      expect(document.getElementById('seg4').className).toBe('seg');

      // Strong password
      updateStrength('StrongPass!123');
      expect(document.getElementById('seg1').className).toBe('seg strong');
      expect(document.getElementById('seg2').className).toBe('seg strong');
      expect(document.getElementById('seg3').className).toBe('seg strong');
      expect(document.getElementById('seg4').className).toBe('seg strong');
    });
  });

  describe('User Login Flows', () => {
    it('should reject login forms if email or password are not set', () => {
      handleLogin();
      const alertNode = document.getElementById('authAlert');
      expect(alertNode.style.display).toBe('block');
      expect(alertNode.textContent).toContain('All fields are required.');
    });

    it('should reject login forms if email does not have a @ character', () => {
      document.getElementById('loginEmail').value = 'bademail';
      document.getElementById('loginPassword').value = 'mypassword';
      handleLogin();
      const alertNode = document.getElementById('authAlert');
      expect(alertNode.style.display).toBe('block');
      expect(alertNode.textContent).toContain('Enter a valid email address.');
    });

    it('should handle login successes and redirect page to GCS MainWindow', () => {
      document.getElementById('loginEmail').value = 'pilot@tihan.in';
      document.getElementById('loginPassword').value = 'password123';

      const originalSetTimeout = window.setTimeout;
      window.setTimeout = jest.fn();

      const sendSpy = jest.spyOn(socket, 'send');
      handleLogin();

      // Verify payload sent
      expect(sendSpy).toHaveBeenCalledWith({
        type: 'login',
        email: 'pilot@tihan.in',
        password: 'password123'
      });

      // Simulate successful login response from C++ backend
      const responseHandler = socket.handlers['login_success'][0];
      responseHandler({ message: 'Login successful' });

      const alertNode = document.getElementById('authAlert');
      expect(alertNode.textContent).toContain('Login successful');

      // Verify redirection timer scheduled
      expect(window.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

      // Restore setTimeout
      window.setTimeout = originalSetTimeout;
      sendSpy.mockRestore();
    });
  });

  describe('User Signup & Real-Time Approvals Flows', () => {
    it('should validate signup credentials before sending requests', () => {
      // 1. Missing fields
      handleSignup();
      expect(document.getElementById('authAlert').textContent).toContain('Please fill in all fields.');

      // 2. Short password
      document.getElementById('signupFirst').value = 'John';
      document.getElementById('signupLast').value = 'Doe';
      document.getElementById('signupEmail').value = 'john@tihan.in';
      document.getElementById('signupPassword').value = '123';
      document.getElementById('signupConfirm').value = '123';
      handleSignup();
      expect(document.getElementById('authAlert').textContent).toContain('Password must be at least 8 characters.');

      // 3. Mismatched confirm
      document.getElementById('signupPassword').value = 'password123';
      document.getElementById('signupConfirm').value = 'different';
      handleSignup();
      expect(document.getElementById('authAlert').textContent).toContain('Passwords do not match.');

      // 4. Missing terms check
      document.getElementById('signupConfirm').value = 'password123';
      handleSignup();
      expect(document.getElementById('authAlert').textContent).toContain('You must accept the Terms of Service.');
    });

    it('should submit registration and support real-time approval full-screen overlays', () => {
      document.getElementById('signupFirst').value = 'Ravi';
      document.getElementById('signupLast').value = 'Kumar';
      document.getElementById('signupEmail').value = 'ravi@tihan.in';
      document.getElementById('signupPassword').value = 'password123';
      document.getElementById('signupConfirm').value = 'password123';
      document.getElementById('termsCheck').checked = true;

      const sendSpy = jest.spyOn(socket, 'send');
      handleSignup();

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'signup',
        firstName: 'Ravi',
        lastName: 'Kumar',
        email: 'ravi@tihan.in',
        password: 'password123'
      });

      // Simulate signup pending response
      socket.handlers['signup_pending'][0]({ message: 'Awaiting admin approval' });
      expect(document.getElementById('authAlert').textContent).toContain('Awaiting admin approval');

      // Simulate admin approval event
      socket.handlers['account_approved'][0]({ message: 'User Ravi approved by admin' });

      // Verify full-screen overlay created in the body
      const proceeds = document.body.innerHTML;
      expect(proceeds).toContain('Account Approved!');
      expect(proceeds).toContain('User Ravi approved by admin');

      sendSpy.mockRestore();
    });
  });

  describe('Admin Portal & Dashboard Systems', () => {
    it('should check admin logins and open dashboard table on success', () => {
      document.getElementById('adminUser').value = 'admin';
      document.getElementById('adminPass').value = 'admin123';

      const sendSpy = jest.spyOn(socket, 'send');
      handleAdminLogin();

      expect(sendSpy).toHaveBeenCalledWith({
        type: 'admin_login',
        username: 'admin',
        password: 'admin123'
      });

      // Simulate success
      socket.handlers['admin_login_success'][0]();

      // Verify navigated to dashboard panel
      expect(document.getElementById('panelDashboard').classList.contains('active')).toBe(true);

      sendSpy.mockRestore();
    });

    it('should fetch user list and render stats, user rows and control buttons', () => {
      // Mock renderUsers directly with dummy users list
      renderUsers([
        {
          id: 'user_123',
          firstName: 'Anil',
          lastName: 'Prasad',
          email: 'anil@tihan.in',
          status: 'pending',
          provider: 'email',
          registeredAt: '2026-06-02T10:00:00.000Z',
          lastLogin: null
        },
        {
          id: 'user_456',
          firstName: 'Sita',
          lastName: 'Raman',
          email: 'sita@google.com',
          status: 'active',
          provider: 'google',
          registeredAt: '2026-06-02T10:30:00.000Z',
          lastLogin: '2026-06-02T11:00:00.000Z'
        }
      ]);

      // Verify stats boxes updated
      expect(document.getElementById('dstatTotal').textContent).toBe('2');
      expect(document.getElementById('dstatActive').textContent).toBe('1');
      expect(document.getElementById('dstatInactive').textContent).toBe('0');

      // Verify user rows rendered in tableBody
      const tbody = document.getElementById('tableBody');
      expect(tbody.innerHTML).toContain('Anil Prasad');
      expect(tbody.innerHTML).toContain('sita@google.com');
      expect(tbody.innerHTML).toContain('✓ Approve'); // pending user gets Approve button
      expect(tbody.innerHTML).toContain('Disable');   // active user gets Disable button
    });

    it('should submit approve/reject ws requests and trigger toasts on admin decisions', () => {
      const sendSpy = jest.spyOn(socket, 'send');

      // 1. Approve User
      approveUser('user_123', 'session_abc');
      expect(sendSpy).toHaveBeenCalledWith({
        type: 'admin_approve',
        userId: 'user_123',
        sessionId: 'session_abc',
        note: 'Approved by TiHAN admin.'
      });

      // Simulate completed
      socket.handlers['admin_action_done'][0]();
      expect(document.body.innerHTML).toContain('User has been notified and can now log in.');

      // 2. Reject User
      rejectUser('user_123', 'session_abc');
      expect(sendSpy).toHaveBeenCalledWith({
        type: 'admin_reject',
        userId: 'user_123',
        sessionId: 'session_abc',
        reason: 'Authorized'
      });

      // Simulate completed
      socket.handlers['admin_action_done'][0]();
      expect(document.body.innerHTML).toContain('User has been notified.');

      sendSpy.mockRestore();
    });

    it('should support disable/enable status toggles and account deletions', () => {
      const sendSpy = jest.spyOn(socket, 'send');

      // 1. Toggle status
      toggleUserStatus('user_456');
      expect(sendSpy).toHaveBeenCalledWith({
        type: 'admin_toggle_status',
        userId: 'user_456'
      });

      // 2. Delete user
      deleteUser('user_456');
      expect(sendSpy).toHaveBeenCalledWith({
        type: 'admin_delete_user',
        userId: 'user_456'
      });

      sendSpy.mockRestore();
    });
  });

  describe('Footer coords updates, Password help, Google Sign-in Mock', () => {
    it('should display admin contact email on forgot password links', () => {
      const event = { preventDefault: jest.fn() };
      showForgot(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(document.getElementById('authAlert').textContent).toContain('Contact admin at tihan@iith.ac.in');
    });

    it('should open and close the Google Client ID modal placeholder', () => {
      const modal = document.getElementById('googleModal');
      
      // Setup modal element
      modal.style.display = 'none';

      handleGoogleLogin();
      expect(modal.style.display).toBe('flex');

      closeGoogleModal();
      expect(modal.style.display).toBe('none');
    });
  });
});