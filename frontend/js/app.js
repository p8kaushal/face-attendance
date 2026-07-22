const App = {
  user: null,
  users: [],
  attendanceUsers: [],
  events: [],
  video: null,
  registerVideo: null,
  hostVideo: null,
  registerModalVideo: null,
  overlay: null,
  registerOverlay: null,
  hostOverlay: null,
  registerModalOverlay: null,
  captureCanvas: document.createElement('canvas'),
  detectionInterval: null,
  registerDetectionInterval: null,
  hostDetectionInterval: null,
  registerModalDetectionInterval: null,
  lastRecognizedUser: null,
  cooldown: false,
  capturedDescriptor: null,
  capturedImageData: null,
  
  // Host event creation face scan state
  capturedHostImageData: null,
  hostStream: null,

  // Register Modal face scan state
  capturedRegisterModalDescriptor: null,
  capturedRegisterModalImageData: null,
  registerModalStream: null,

  // QR scan tracking
  qrScanInterval: null,
  selectedEventId: null,
  lastScannedQRToken: null,
  activeQRToken: null,
  qrAnimationId: null,
  lastFaceDetection: null,
  lastQRLocation: null,

  // Liveness check tracking state
  livenessState: {
    earHistory: [],
    yawHistory: [],
    blinked: false,
    headTurned: false
  },

  resetLiveness() {
    this.livenessState = {
      earHistory: [],
      yawHistory: [],
      blinked: false,
      headTurned: false
    };
  },

  async init() {
    console.log('Initializing app...');
    
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered successfully:', reg);
      } catch (err) {
        console.error('Service Worker registration failed:', err);
      }

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SYNC_COMPLETE') {
          this.showToast('Offline attendance synced successfully!', 'success');
          this.loadData();
        }
      });
    }

    // Initialize DB
    await DB.init();

    this.video = document.getElementById('video');
    this.registerVideo = document.getElementById('register-video');
    this.hostVideo = document.getElementById('host-scan-video');
    this.registerModalVideo = document.getElementById('register-modal-video');
    
    this.overlay = document.getElementById('overlay');
    this.registerOverlay = document.getElementById('register-overlay');
    this.hostOverlay = document.getElementById('host-scan-overlay');
    this.registerModalOverlay = document.getElementById('register-modal-overlay');
    
    this.captureCanvas = document.createElement('canvas');

    this.setupNavigation();
    this.setupRegister();
    this.setupLogs();
    this.setupHostEventCreation();
    this.setupRegisterModalFaceScan();
    this.setupAttendanceButtons();

    const modelsLoaded = await FaceAPI.loadModels();
    document.getElementById('status-badge').textContent = modelsLoaded ? 'Select event or scan QR code to start' : 'Model error';

    await this.checkAuth();

    // Check if QR token exists in URL
    const urlParams = new URLSearchParams(window.location.search);
    const qrToken = urlParams.get('qr');
    if (qrToken) {
      this.navigateTo('attendance');
      this.decodeAndSelectQREvent(qrToken);
      this.startAttendanceCamera();
    }
  },

  setupAttendanceButtons() {
    const startBtn = document.getElementById('start-scanning-btn');
    const stopBtn = document.getElementById('stop-scanning-btn');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const urlParams = new URLSearchParams(window.location.search);
        const qrToken = urlParams.get('qr');
        
        if (!this.selectedEventId && !qrToken) {
          this.showToast('Please select an event or scan a QR code to start', 'error');
          return;
        }
        this.startAttendanceCamera();
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        this.stopAttendanceCamera();
      });
    }

    const cameraQrBtn = document.getElementById('camera-qr-scan-btn');
    if (cameraQrBtn) {
      cameraQrBtn.addEventListener('click', () => {
        this.startAttendanceCamera();
        this.showToast('Camera active. Place the event QR code in front of the lens.', 'success');
      });
    }

    const qrFileInput = document.getElementById('qr-file-input');
    if (qrFileInput) {
      qrFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);

            if (code && code.data && code.data.includes('qr=')) {
              const qrToken = code.data.split('qr=')[1];
              this.decodeAndSelectQREvent(qrToken);
              this.showToast('Event QR code image uploaded successfully!', 'success');
            } else {
              this.showToast('No valid event QR code found in the uploaded image', 'error');
            }
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      });
    }
  },

  async decodeAndSelectQREvent(qrToken) {
    try {
      const base64Url = qrToken.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      const decoded = JSON.parse(jsonPayload);
      if (decoded && decoded.eventId) {
        await this.selectEvent(decoded.eventId, qrToken);
      }
    } catch (e) {
      console.error('Failed to parse QR token:', e);
    }
  },

  async selectEvent(eventId, qrToken = null) {
    const activeDisplay = document.getElementById('active-event-display');
    const activeName = document.getElementById('active-event-name');

    if (!eventId) {
      this.selectedEventId = null;
      document.getElementById('event-creator-details').classList.add('hidden');
      if (activeDisplay) activeDisplay.classList.add('hidden');
      return;
    }

    this.selectedEventId = eventId;
    this.activeQRToken = qrToken;

    const select = document.getElementById('attendance-event-select');
    if (select) select.value = eventId;

    if (qrToken) {
      window.history.pushState(null, '', `/?qr=${qrToken}`);
    }

    try {
      const event = await API.request(`/api/events/${eventId}`);
      
      // Dynamically add the option to the select dropdown if it doesn't already exist
      if (select && !Array.from(select.options).some(opt => opt.value == eventId)) {
        const opt = document.createElement('option');
        opt.value = event.id;
        opt.textContent = event.name;
        select.appendChild(opt);
      }
      if (select) select.value = eventId;

      if (activeDisplay && activeName) {
        activeDisplay.classList.remove('hidden');
        activeName.textContent = event.name || `Event #${eventId}`;
      }

      this.showEventCreatorDetails(event);
      this.showToast(`Active Event: ${event.name}`, 'success');
    } catch (e) {
      // Offline fallback
      const localEvent = this.events.find(ev => ev.id == eventId);
      if (localEvent) {
        if (activeDisplay && activeName) {
          activeDisplay.classList.remove('hidden');
          activeName.textContent = localEvent.name;
        }
        this.showEventCreatorDetails(localEvent);
      } else {
        if (activeDisplay && activeName) {
          activeDisplay.classList.remove('hidden');
          activeName.textContent = `Event #${eventId}`;
        }
        document.getElementById('event-creator-details').classList.remove('hidden');
        document.getElementById('creator-host-name').textContent = 'Event ID: ' + eventId + ' (Offline)';
        document.getElementById('creator-host-avatar').style.display = 'none';
      }
    }
  },

  showEventCreatorDetails(event) {
    const creatorCard = document.getElementById('event-creator-details');
    const nameEl = document.getElementById('creator-host-name');
    const avatarEl = document.getElementById('creator-host-avatar');
    const locEl = document.getElementById('event-location-display');

    if (creatorCard) creatorCard.classList.remove('hidden');
    if (nameEl) nameEl.textContent = event.host_name || 'Host';
    if (avatarEl) {
      if (event.host_image) {
        avatarEl.src = event.host_image;
        avatarEl.style.display = 'block';
      } else {
        avatarEl.style.display = 'none';
      }
    }
    if (locEl && event.latitude !== undefined && event.longitude !== undefined) {
      locEl.innerHTML = `Lat: ${parseFloat(event.latitude).toFixed(4)}<br>Lon: ${parseFloat(event.longitude).toFixed(4)}<br>Radius: ${event.radius_meters}m`;
    }
  },

  async checkAuth() {
    try {
      this.user = await API.getMe();
      this.updateAuthUI();
      await this.loadData();
    } catch (e) {
      this.user = null;
      this.updateAuthUI();
      try {
        this.attendanceUsers = await API.getUsersForAttendance();
      } catch (err) {
        this.attendanceUsers = await DB.getAllUsers();
      }
    }
  },

  updateAuthUI() {
    const isLoggedIn = !!this.user;
    const role = this.user?.role || 'attendee';
    const isAdmin = this.user?.isAdmin || role === 'admin';
    const isHost = role === 'host';

    document.body.classList.toggle('is-admin', isAdmin);
    document.getElementById('login-btn').classList.toggle('hidden', isLoggedIn);
    document.getElementById('logout-btn').classList.toggle('hidden', !isLoggedIn);
    document.getElementById('user-info').classList.toggle('hidden', !isLoggedIn);
    
    if (isLoggedIn) {
      document.getElementById('user-avatar').src = this.user.avatar || '';
      document.getElementById('user-avatar').style.display = this.user.avatar ? 'block' : 'none';
      document.getElementById('user-name').textContent = this.user.username || this.user.name || this.user.email;
      
      const badge = document.getElementById('admin-badge');
      badge.classList.remove('hidden');
      badge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    }

    // Toggle navigation tabs strictly based on roles
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
    document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !isHost));
    document.querySelectorAll('.attendee-only').forEach(el => el.classList.toggle('hidden', role !== 'attendee'));
  },

  async loadData() {
    if (navigator.onLine) {
      await this.syncOfflineQueueForeground();
    }

    try {
      this.attendanceUsers = await API.getUsersForAttendance();
      for (const u of this.attendanceUsers) {
        await DB.addUser(u);
      }
    } catch (e) {
      this.attendanceUsers = await DB.getAllUsers();
    }

    // Populate events list
    try {
      this.events = await API.getEvents();
      this.populateEventsDropdown();
    } catch (e) {
      console.warn('Failed to load events list', e);
    }

    if (!this.user) return;
    try {
      this.users = await API.getUsers();
      this.renderUsers();
      this.renderLogs();
      this.renderTodayAttendance();
      this.populateUserFilter();
      
      if (this.user.role === 'host') {
        this.renderHostEvents();
      }
      if (this.user.role === 'attendee') {
        this.renderAttendeeDashboard();
      }
    } catch (e) {
      this.showToast('Failed to load dashboard data', 'error');
    }
  },

  async syncOfflineQueueForeground() {
    try {
      const queue = await DB.getOfflineQueue();
      if (queue.length === 0) return;

      console.log('Online detected. Syncing offline queue in foreground...', queue);
      for (const record of queue) {
        await API.recordAttendance(
          record.userId,
          record.type || null,
          record.qrToken || null,
          record.eventId || null,
          record.latitude || null,
          record.longitude || null,
          record.offlineUuid || null,
          record.timestamp || null
        );
        await DB.deleteFromOfflineQueue(record.id);
      }
      this.showToast('Offline attendance synced successfully!', 'success');
    } catch (err) {
      console.warn('Foreground sync failed:', err);
    }
  },

  populateEventsDropdown() {
    const select = document.getElementById('attendance-event-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Event --</option>' +
      this.events.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

    select.addEventListener('change', () => {
      this.selectEvent(select.value);
    });
  },

  setupNavigation() {
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    const closeMenu = () => {
      if (!menuToggle || !navLinks) return;
      menuToggle.classList.remove('active');
      navLinks.classList.remove('show');
      menuToggle.setAttribute('aria-expanded', 'false');
    };

    menuToggle?.addEventListener('click', (e) => {
      if (!navLinks) return;
      e.stopPropagation();
      const isOpen = menuToggle.classList.toggle('active');
      navLinks.classList.toggle('show', isOpen);
      menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    const handleNavClick = (btn) => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      closeMenu();
      
      // Stop all camera streams when leaving tabs (Optimise battery and compute)
      this.stopAttendanceCamera();
      this.stopHostCamera();
      this.stopRegisterModalCamera();
      this.stopRegisterCamera();

      if (btn.dataset.tab === 'attendance') {
        document.getElementById('start-scanning-btn').classList.remove('hidden');
        document.getElementById('stop-scanning-btn').classList.add('hidden');
        document.getElementById('status-badge').textContent = 'Select event or scan QR code to start';
      }
    };

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        closeMenu();
      }
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => handleNavClick(btn));
    });

    document.addEventListener('click', (e) => {
      if (navLinks && navLinks.classList.contains('show')) {
        if (!navLinks.contains(e.target) && !menuToggle?.contains(e.target)) {
          menuToggle?.classList.remove('active');
          navLinks.classList.remove('show');
        }
      }
    });

    document.getElementById('login-btn').addEventListener('click', () => this.showLoginModal());
    document.getElementById('login-google')?.addEventListener('click', () => {
      window.location.href = `/auth/google`;
    });
    document.getElementById('login-github')?.addEventListener('click', () => {
      window.location.href = `/auth/github`;
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await API.request('/auth/logout', { method: 'GET' });
      this.user = null;
      this.updateAuthUI();
      this.showToast('Logged out');
    });

    this.setupLoginModal();
  },

  setupLoginModal() {
    const modal = document.getElementById('login-modal');
    const backdrop = modal.querySelector('.modal-backdrop');
    const closeBtn = modal.querySelector('.modal-close');
    const tabs = modal.querySelectorAll('.modal-tab');
    const loginForm = document.getElementById('local-login-form');
    const registerForm = document.getElementById('local-register-form');

    const closeModal = () => {
      this.stopRegisterModalCamera();
      modal.classList.remove('show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    };
    backdrop.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.form === 'login') {
          loginForm.classList.remove('hidden');
          registerForm.classList.add('hidden');
          this.stopRegisterModalCamera();
        } else {
          loginForm.classList.add('hidden');
          registerForm.classList.remove('hidden');
        }
      });
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        const user = await API.localLogin(username, password);
        this.user = user;
        this.updateAuthUI();
        closeModal();
        this.showToast('Welcome, ' + user.username, 'success');
        await this.loadData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (!this.capturedRegisterModalDescriptor) {
          throw new Error('Mandatory Face scan is required to register account');
        }

        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const confirm = document.getElementById('register-confirm').value;
        const employeeId = document.getElementById('register-employee-id').value;
        const role = document.getElementById('register-role').value;
        
        if (password !== confirm) throw new Error('Passwords do not match');
        
        const user = await API.request('/auth/local/register', {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            role,
            employeeId,
            faceDescriptor: Array.from(this.capturedRegisterModalDescriptor),
            imageData: this.capturedRegisterModalImageData
          })
        });
        
        this.user = user;
        this.updateAuthUI();
        closeModal();
        this.showToast('Account created successfully!', 'success');
        await this.loadData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });
  },

  showLoginModal() {
    const modal = document.getElementById('login-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('show'), 10);
  },

  async startAttendanceCamera() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' } });
    } catch (err) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      } catch (e) {
        this.showToast('Camera access denied', 'error');
        return;
      }
    }
    try {
      this.video.srcObject = stream;
      
      const onPlay = () => {
        this.overlay.width = this.video.videoWidth || 640;
        this.overlay.height = this.video.videoHeight || 480;
      };
      this.video.addEventListener('playing', onPlay, { once: true });

      await this.video.play();
      this.resetLiveness();
      
      document.getElementById('start-scanning-btn').classList.add('hidden');
      document.getElementById('stop-scanning-btn').classList.remove('hidden');

      this.startDetection();
      this.startQRScanning();
    } catch (e) {
      this.showToast('Camera initialization failed', 'error');
    }
  },

  stopAttendanceCamera() {
    if (this.video && this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(track => track.stop());
      this.video.srcObject = null;
    }
    clearInterval(this.detectionInterval);
    clearInterval(this.qrScanInterval);
    FaceAPI.clearCanvas(this.overlay);

    const startBtn = document.getElementById('start-scanning-btn');
    const stopBtn = document.getElementById('stop-scanning-btn');
    if (startBtn) startBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
  },

  startQRScanning() {
    if (this.qrScanInterval) clearInterval(this.qrScanInterval);
    this.lastScannedQRToken = null;
    this.qrScanInterval = setInterval(() => {
      if (!this.video || this.video.paused || this.video.ended) return;
      try {
        if (typeof jsQR === 'undefined') {
          console.warn('jsQR is not loaded yet');
          return;
        }

        const width = this.video.videoWidth;
        const height = this.video.videoHeight;
        if (!width || !height) return;

        // ROI crop: Scan only the central region aligned with our visual brackets (60% size)
        const boxSize = Math.floor(Math.min(width, height) * 0.60);
        const sx = Math.floor((width - boxSize) / 2);
        const sy = Math.floor((height - boxSize) / 2);

        this.captureCanvas.width = boxSize;
        this.captureCanvas.height = boxSize;
        const ctx = this.captureCanvas.getContext('2d');
        
        // Draw only the cropped center region of the video stream
        ctx.drawImage(this.video, sx, sy, boxSize, boxSize, 0, 0, boxSize, boxSize);

        const imageData = ctx.getImageData(0, 0, boxSize, boxSize);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && code.data && code.data.includes('qr=')) {
          let qrToken = null;
          try {
            const url = new URL(code.data);
            qrToken = url.searchParams.get('qr');
          } catch(e) {
            qrToken = code.data.split('qr=')[1];
          }

          if (qrToken && this.lastScannedQRToken !== qrToken) {
            this.lastScannedQRToken = qrToken;
            
            // Map the detected relative cropped coordinates back to the full camera coordinate space
            this.lastQRLocation = {
              topLeftCorner: { x: code.location.topLeftCorner.x + sx, y: code.location.topLeftCorner.y + sy },
              topRightCorner: { x: code.location.topRightCorner.x + sx, y: code.location.topRightCorner.y + sy },
              bottomLeftCorner: { x: code.location.bottomLeftCorner.x + sx, y: code.location.bottomLeftCorner.y + sy },
              bottomRightCorner: { x: code.location.bottomRightCorner.x + sx, y: code.location.bottomRightCorner.y + sy }
            };

            // Render the success highlight box immediately before intervals are cleared!
            FaceAPI.clearCanvas(this.overlay);
            this.drawScannerOverlayOnCanvas(this.overlay);

            // Stop scanning and detection to free up the CPU thread for the network request!
            clearInterval(this.qrScanInterval);
            clearInterval(this.detectionInterval);
            this.qrScanInterval = null;
            this.detectionInterval = null;

            document.getElementById('status-badge').textContent = 'Analyzing QR Code...';
            
            setTimeout(() => { this.lastQRLocation = null; }, 1200);
            
            this.decodeAndSelectQREvent(qrToken).finally(() => {
              // Restart face detection now that event is loaded
              this.startDetection();
            });
            this.showToast('Event QR code scanned successfully!', 'success');
          }
        }
      } catch (e) {
        console.error('QR parsing error:', e);
      }
    }, 200); // 200ms check interval for extremely fast response
  },

  drawScannerOverlayOnCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Center Scanning Reticle Box
    const boxSize = Math.min(width, height) * 0.55;
    const x = (width - boxSize) / 2;
    const y = (height - boxSize) / 2;

    // Target Corner Brackets
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    // Top Left Corner
    ctx.beginPath();
    ctx.moveTo(x, y + 24);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 24, y);
    ctx.stroke();

    // Top Right Corner
    ctx.beginPath();
    ctx.moveTo(x + boxSize, y + 24);
    ctx.lineTo(x + boxSize, y);
    ctx.lineTo(x + boxSize - 24, y);
    ctx.stroke();

    // Bottom Left Corner
    ctx.beginPath();
    ctx.moveTo(x, y + boxSize - 24);
    ctx.lineTo(x, y + boxSize);
    ctx.lineTo(x + 24, y + boxSize);
    ctx.stroke();

    // Bottom Right Corner
    ctx.beginPath();
    ctx.moveTo(x + boxSize, y + boxSize - 24);
    ctx.lineTo(x + boxSize, y + boxSize);
    ctx.lineTo(x + boxSize - 24, y + boxSize);
    ctx.stroke();

    // Red Laser Sweep Line
    const time = performance.now() * 0.003;
    const laserY = y + (Math.sin(time) * 0.5 + 0.5) * boxSize;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x + 6, laserY);
    ctx.lineTo(x + boxSize - 6, laserY);
    ctx.stroke();
    ctx.shadowBlur = 0; // Reset shadow

    // Display QR Code highlight if detected
    if (this.lastQRLocation) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(this.lastQRLocation.topLeftCorner.x, this.lastQRLocation.topLeftCorner.y);
      ctx.lineTo(this.lastQRLocation.topRightCorner.x, this.lastQRLocation.topRightCorner.y);
      ctx.lineTo(this.lastQRLocation.bottomRightCorner.x, this.lastQRLocation.bottomRightCorner.y);
      ctx.lineTo(this.lastQRLocation.bottomLeftCorner.x, this.lastQRLocation.bottomLeftCorner.y);
      ctx.closePath();
      ctx.stroke();

      // Successful Scan Visual Notification Text
      ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
      ctx.fillRect(x + 20, y + boxSize / 2 - 25, boxSize - 40, 50);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✓ QR Code Scanned!', width / 2, y + boxSize / 2 + 6);
    }
  },

  startDetection() {
    if (this.detectionInterval) clearInterval(this.detectionInterval);
    this.detectionInterval = setInterval(async () => {
      if (!FaceAPI.modelsLoaded || this.cooldown) return;
      try {
        const detectedEl = document.getElementById('detected-user');
        const statusBadge = document.getElementById('status-badge');

        if (!this.selectedEventId) {
          FaceAPI.clearCanvas(this.overlay);
          this.drawScannerOverlayOnCanvas(this.overlay);
          this.resetLiveness();
          statusBadge.textContent = 'Align Event QR Code in Scanner';
          detectedEl.innerHTML = `<span class="placeholder">Please select an event or scan QR first</span>`;
          return;
        }

        const detections = await FaceAPI.detectFace(this.video);
        FaceAPI.clearCanvas(this.overlay);

        // Render the visual reticle and sweep bar animations
        this.drawScannerOverlayOnCanvas(this.overlay);

        if (detections.length === 0) {
          this.resetLiveness();
          if (!this.selectedEventId) {
            statusBadge.textContent = 'Align Event QR Code in Scanner';
          } else {
            statusBadge.textContent = 'Position your face';
          }
          detectedEl.innerHTML = `<span class="placeholder">Waiting for face...</span>`;
          return;
        }

        if (detections.length === 1) {
          const detection = detections[0];
          const liveness = FaceAPI.detectLiveness(detection.landmarks, this.livenessState);
          
          if (!this.livenessState.ticks) this.livenessState.ticks = 0;
          this.livenessState.ticks++;

          if (!liveness.blinked && this.livenessState.ticks < 8) {
            statusBadge.textContent = `Liveness: Blink your eyes (EAR: ${liveness.avgEAR.toFixed(2)})`;
            FaceAPI.drawFaceBox(this.overlay, detection, '#3b82f6');
            detectedEl.innerHTML = `<span class="placeholder">Verifying Liveness...</span>`;
            return;
          }

          statusBadge.textContent = 'Liveness Verified';
          const match = FaceAPI.findMatchingUser(detection.descriptor, this.attendanceUsers);
          FaceAPI.drawFaceBox(this.overlay, detection, match ? '#10b981' : '#6b7280');
          
          if (match) {
            detectedEl.innerHTML = `<div class="name">${match.name}</div><div class="status">Recognized</div>`;
            if (this.lastRecognizedUser !== match.id) {
              this.lastRecognizedUser = match.id;
              await this.recordAttendance(match.id);
            }
          } else {
            detectedEl.innerHTML = `<span class="placeholder">Unknown Person</span>`;
            this.lastRecognizedUser = null;
          }
        } else {
          statusBadge.textContent = 'Multiple Faces';
          detectedEl.innerHTML = `<span class="placeholder">Multiple faces detected</span>`;
        }
      } catch (e) {
        console.error(e);
      }
    }, 200);
  },

  async getCoordinates() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        return resolve({ latitude: null, longitude: null });
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve({ latitude: null, longitude: null }),
        { timeout: 5000 }
      );
    });
  },

  async recordAttendance(userId) {
    this.cooldown = true;
    try {
      const today = new Date().toISOString().split('T')[0];
      const coords = await this.getCoordinates();
      
      const urlParams = new URLSearchParams(window.location.search);
      const qrToken = this.activeQRToken || urlParams.get('qr') || null;

      const offlineUuid = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      if (!navigator.onLine) {
        throw new Error('Offline');
      }

      const res = await API.recordAttendance(userId, null, qrToken, this.selectedEventId, coords.latitude, coords.longitude, offlineUuid, timestamp);
      const recordedType = res.type || 'in';
      this.showToast(`Checked ${recordedType} successfully!`, recordedType === 'in' ? 'success' : '');
      this.resetLiveness();
      await this.loadData();
    } catch (e) {
      const offlineErrors = ['Offline', 'Failed to fetch', 'NetworkError', 'Load failed', 'TypeError'];
      const isOfflineError = offlineErrors.some(err => e.message && e.message.includes(err));

      if (isOfflineError) {
        // Save offline check-in
        try {
          const coords = await this.getCoordinates();
          const urlParams = new URLSearchParams(window.location.search);
          const qrToken = this.activeQRToken || urlParams.get('qr') || null;
          const offlineUuid = crypto.randomUUID();
          const timestamp = new Date().toISOString();

          await DB.addToOfflineQueue({
            userId,
            type: 'in',
            qrToken,
            eventId: this.selectedEventId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            offlineUuid,
            timestamp
          });

          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const reg = await navigator.serviceWorker.ready;
            await reg.sync.register('sync-attendance');
          }

          this.showToast('Offline: Attendance queued for background sync', 'success');
          this.resetLiveness();
        } catch (dbErr) {
          this.showToast('Failed to queue offline: ' + dbErr.message, 'error');
          this.resetLiveness();
        }
      } else {
        // Display validation error directly (e.g. "QR Code expired")
        this.showToast(e.message || 'Request failed', 'error');
        this.resetLiveness();
      }
    }
    setTimeout(() => { this.cooldown = false; this.lastRecognizedUser = null; }, 4000);
  },

  async renderTodayAttendance() {
    const list = document.getElementById('today-list');
    const today = new Date().toISOString().split('T')[0];
    let records = [];
    try {
      records = await API.getAttendance({ date: today });
    } catch (e) {
      records = await DB.getAttendanceByDate(today);
    }
    
    if (records.length === 0) {
      list.innerHTML = '<div class="attendance-item"><span>No attendance today</span></div>';
      return;
    }

    const latest = {};
    records.forEach(r => { if (!latest[r.user_id] || new Date(r.check_in) > new Date(latest[r.user_id].check_in)) latest[r.user_id] = r; });

    list.innerHTML = Object.values(latest).map(r => {
      const time = new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const status = r.check_out ? 'out' : 'in';
      const statusText = r.check_out ? 'Out' : 'In';
      return `<div class="attendance-item"><span>${r.name}</span><span class="time">${time} <span class="status ${status}">${statusText}</span></span></div>`;
    }).join('');
  },

  setupRegister() {
    document.querySelector('[data-tab="register"]').addEventListener('click', () => {
      if (!this.user?.isAdmin) return;
      this.startRegisterCamera();
    });

    document.getElementById('capture-btn').addEventListener('click', async () => {
      try {
        if (!this.registerVideo || !this.registerVideo.srcObject) throw new Error('Camera stream not active');

        this.capturedDescriptor = await FaceAPI.captureFaceDescriptor(this.registerVideo);

        const width = this.registerVideo.videoWidth || this.registerVideo.clientWidth || 320;
        const height = this.registerVideo.videoHeight || this.registerVideo.clientHeight || 240;

        this.captureCanvas.width = width;
        this.captureCanvas.height = height;
        this.captureCanvas.getContext('2d').drawImage(this.registerVideo, 0, 0, width, height);
        this.capturedImageData = this.captureCanvas.toDataURL('image/jpeg', 0.9);

        document.getElementById('captured-image').src = this.capturedImageData;
        document.getElementById('capture-preview').classList.remove('hidden');
        document.getElementById('capture-btn').classList.add('hidden');
        document.getElementById('retake-btn').classList.remove('hidden');

        this.stopRegisterCamera();
        this.showToast('Image captured successfully', 'success');
      } catch (e) {
        this.showToast(e.message || 'Capture failed', 'error');
      }
    });

    document.getElementById('retake-btn').addEventListener('click', () => {
      this.capturedDescriptor = null;
      this.capturedImageData = null;
      document.getElementById('capture-preview').classList.add('hidden');
      document.getElementById('capture-btn').classList.remove('hidden');
      document.getElementById('retake-btn').classList.add('hidden');
      document.getElementById('register-form').reset();
      this.startRegisterCamera();
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const role = document.getElementById('employee-role').value;
        await API.request('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            employeeId: document.getElementById('employee-id').value.trim(),
            name: document.getElementById('employee-name').value.trim(),
            faceDescriptor: Array.from(this.capturedDescriptor),
            imageData: this.capturedImageData,
            role
          })
        });
        this.showToast('User registered successfully', 'success');
        this.capturedDescriptor = null;
        this.capturedImageData = null;
        document.getElementById('capture-preview').classList.add('hidden');
        document.getElementById('capture-btn').classList.remove('hidden');
        document.getElementById('retake-btn').classList.add('hidden');
        document.getElementById('register-form').reset();
        await this.loadData();
      } catch (e) { this.showToast(e.message, 'error'); }
    });
  },

  async startRegisterCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
      this.registerVideo.srcObject = stream;
      await this.registerVideo.play();

      document.getElementById('capture-btn').disabled = true;
      document.getElementById('capture-btn').classList.remove('hidden');
      document.getElementById('retake-btn').classList.add('hidden');
      document.getElementById('capture-preview').classList.add('hidden');

      this.registerOverlay.width = this.registerVideo.videoWidth || this.registerVideo.clientWidth;
      this.registerOverlay.height = this.registerVideo.videoHeight || this.registerVideo.clientHeight;
      this.startRegisterDetection();
    } catch (e) {
      this.showToast('Camera access denied or not available', 'error');
    }
  },

  stopRegisterCamera() {
    if (this.registerVideo && this.registerVideo.srcObject) {
      this.registerVideo.srcObject.getTracks().forEach(t => t.stop());
      this.registerVideo.srcObject = null;
    }
    clearInterval(this.registerDetectionInterval);
    FaceAPI.clearCanvas(this.registerOverlay);
  },

  startRegisterDetection() {
    clearInterval(this.registerDetectionInterval);
    this.registerDetectionInterval = setInterval(async () => {
      if (!FaceAPI.modelsLoaded) return;
      try {
        const detections = await FaceAPI.detectFace(this.registerVideo);
        FaceAPI.clearCanvas(this.registerOverlay);
        document.getElementById('capture-btn').disabled = detections.length !== 1;
        if (detections.length === 1) FaceAPI.drawFaceBox(this.registerOverlay, detections[0], '#10b981');
      } catch (e) {}
    }, 500);
  },

  // Register Modal mandatory face scan module
  setupRegisterModalFaceScan() {
    const scanBtn = document.getElementById('register-modal-scan-btn');
    const captureBtn = document.getElementById('register-modal-capture-btn');
    
    if (scanBtn) {
      scanBtn.addEventListener('click', async () => {
        try {
          if (!this.registerModalVideo.srcObject) {
            this.registerModalStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
            this.registerModalVideo.srcObject = this.registerModalStream;
            await this.registerModalVideo.play();
            
            this.registerModalOverlay.width = this.registerModalVideo.videoWidth || this.registerModalVideo.clientWidth;
            this.registerModalOverlay.height = this.registerModalVideo.videoHeight || this.registerModalVideo.clientHeight;
            
            scanBtn.classList.add('hidden');
            captureBtn.classList.remove('hidden');
            captureBtn.disabled = true;

            this.registerModalDetectionInterval = setInterval(async () => {
              if (!FaceAPI.modelsLoaded) return;
              const detections = await FaceAPI.detectFace(this.registerModalVideo);
              FaceAPI.clearCanvas(this.registerModalOverlay);
              captureBtn.disabled = detections.length !== 1;
              if (detections.length === 1) FaceAPI.drawFaceBox(this.registerModalOverlay, detections[0], '#10b981');
            }, 500);
          }
        } catch (e) {
          this.showToast('Camera verification failed: ' + e.message, 'error');
        }
      });
    }

    if (captureBtn) {
      captureBtn.addEventListener('click', async () => {
        try {
          this.capturedRegisterModalDescriptor = await FaceAPI.captureFaceDescriptor(this.registerModalVideo);
          
          const width = this.registerModalVideo.videoWidth || 320;
          const height = this.registerModalVideo.videoHeight || 240;
          this.captureCanvas.width = width;
          this.captureCanvas.height = height;
          this.captureCanvas.getContext('2d').drawImage(this.registerModalVideo, 0, 0, width, height);
          
          this.capturedRegisterModalImageData = this.captureCanvas.toDataURL('image/jpeg', 0.9);
          document.getElementById('register-modal-img').src = this.capturedRegisterModalImageData;
          document.getElementById('register-modal-preview').classList.remove('hidden');
          
          this.stopRegisterModalCamera();
          scanBtn.classList.remove('hidden');
          scanBtn.textContent = 'Retake Face Scan';
          captureBtn.classList.add('hidden');
          
          this.showToast('Register face verification completed!', 'success');
        } catch (e) {
          this.showToast('Scan failed: ' + e.message, 'error');
        }
      });
    }
  },

  stopRegisterModalCamera() {
    if (this.registerModalStream) {
      this.registerModalStream.getTracks().forEach(t => t.stop());
      this.registerModalStream = null;
    }
    if (this.registerModalVideo) this.registerModalVideo.srcObject = null;
    clearInterval(this.registerModalDetectionInterval);
    FaceAPI.clearCanvas(this.registerModalOverlay);
  },

  // Host Event Creation Panel
  setupHostEventCreation() {
    const sourceSelect = document.getElementById('event-location-source');
    const customInputs = document.getElementById('custom-location-inputs');
    
    if (sourceSelect && customInputs) {
      sourceSelect.addEventListener('change', () => {
        customInputs.classList.toggle('hidden', sourceSelect.value !== 'custom');
      });
    }

    // Host Scan Face Camera trigger
    const scanBtn = document.getElementById('host-scan-btn');
    const retakeBtn = document.getElementById('host-scan-retake');
    
    if (scanBtn) {
      scanBtn.addEventListener('click', async () => {
        try {
          if (!this.hostVideo.srcObject) {
            this.hostStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } });
            this.hostVideo.srcObject = this.hostStream;
            await this.hostVideo.play();
            this.hostOverlay.width = this.hostVideo.videoWidth || this.hostVideo.clientWidth;
            this.hostOverlay.height = this.hostVideo.videoHeight || this.hostVideo.clientHeight;
            
            scanBtn.textContent = 'Capture';
            retakeBtn.classList.add('hidden');
            
            this.hostDetectionInterval = setInterval(async () => {
              if (!FaceAPI.modelsLoaded) return;
              const detections = await FaceAPI.detectFace(this.hostVideo);
              FaceAPI.clearCanvas(this.hostOverlay);
              if (detections.length === 1) FaceAPI.drawFaceBox(this.hostOverlay, detections[0], '#10b981');
            }, 500);
          } else {
            const width = this.hostVideo.videoWidth || 320;
            const height = this.hostVideo.videoHeight || 240;
            this.captureCanvas.width = width;
            this.captureCanvas.height = height;
            this.captureCanvas.getContext('2d').drawImage(this.hostVideo, 0, 0, width, height);
            
            this.capturedHostImageData = this.captureCanvas.toDataURL('image/jpeg', 0.9);
            document.getElementById('host-scan-img').src = this.capturedHostImageData;
            document.getElementById('host-scan-preview').classList.remove('hidden');
            
            this.stopHostCamera();
            
            scanBtn.textContent = 'Scan Face';
            retakeBtn.classList.remove('hidden');
          }
        } catch (e) {
          this.showToast('Host camera failed: ' + e.message, 'error');
        }
      });
    }

    if (retakeBtn) {
      retakeBtn.addEventListener('click', () => {
        this.capturedHostImageData = null;
        document.getElementById('host-scan-preview').classList.add('hidden');
        retakeBtn.classList.add('hidden');
      });
    }

    const form = document.getElementById('create-event-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          if (!this.capturedHostImageData) {
            throw new Error('Host identity face scan is required to create event');
          }

          let lat, lon;
          if (sourceSelect.value === 'current') {
            const coords = await this.getCoordinates();
            if (coords.latitude === null) throw new Error('Failed to retrieve current GPS coordinates. Please select Custom Coordinates instead.');
            lat = coords.latitude;
            lon = coords.longitude;
          } else {
            lat = parseFloat(document.getElementById('event-lat').value);
            lon = parseFloat(document.getElementById('event-lon').value);
            if (isNaN(lat) || isNaN(lon)) throw new Error('Invalid custom coordinates entered');
          }

          await API.createEvent({
            name: document.getElementById('event-name').value.trim(),
            radius_meters: parseFloat(document.getElementById('event-radius').value),
            latitude: lat,
            longitude: lon,
            host_image: this.capturedHostImageData
          });

          this.showToast('Event created successfully', 'success');
          form.reset();
          this.capturedHostImageData = null;
          document.getElementById('host-scan-preview').classList.add('hidden');
          retakeBtn.classList.add('hidden');
          await this.loadData();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      });
    }
  },

  stopHostCamera() {
    if (this.hostStream) {
      this.hostStream.getTracks().forEach(t => t.stop());
      this.hostStream = null;
    }
    if (this.hostVideo) this.hostVideo.srcObject = null;
    clearInterval(this.hostDetectionInterval);
    FaceAPI.clearCanvas(this.hostOverlay);
  },

  async renderHostEvents() {
    const listEl = document.getElementById('host-events-list');
    if (!listEl) return;
    
    if (this.events.length === 0) {
      listEl.innerHTML = '<span class="placeholder">No events created yet.</span>';
      return;
    }

    listEl.innerHTML = this.events.map(ev => `
      <div class="attendance-item" style="cursor: pointer; padding: 12px; border-radius: 6px; background: var(--bg-hover);" onclick="App.selectHostEvent(${ev.id})">
        <div>
          <strong style="color: var(--text-primary);">${ev.name}</strong>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 3px;">
            Range: ${ev.radius_meters}m | Loc: ${ev.latitude.toFixed(4)}, ${ev.longitude.toFixed(4)}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm">Manage</button>
      </div>
    `).join('');
  },

  async selectHostEvent(eventId) {
    const container = document.getElementById('event-management-details');
    const placeholder = document.getElementById('no-event-selected-placeholder');
    const qrDiv = document.getElementById('qrcode');
    const titleEl = document.getElementById('managed-event-title');
    const tbody = document.getElementById('event-attendees-tbody');

    if (!container) return;

    try {
      const event = this.events.find(e => e.id === eventId);
      if (!event) return;

      placeholder.classList.add('hidden');
      container.classList.remove('hidden');
      titleEl.textContent = `Manage: ${event.name}`;

      // Generate JWT-based QR
      const qrRes = await API.generateEventQR(eventId, 86400); // 24 hour expiry QR
      const hostUrl = `${window.location.origin}/?qr=${qrRes.token}`;
      qrDiv.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(hostUrl)}" alt="QR Code">`;
      
      // Setup Download button
      document.getElementById('download-qr-btn').onclick = () => {
        const a = document.createElement('a');
        a.href = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(hostUrl)}`;
        a.target = '_blank';
        a.download = `${event.name}_qr.png`;
        a.click();
      };

      // Load Attendees
      const attendees = await API.request(`/api/events/${eventId}/attendance`);
      if (attendees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-secondary)">No check-ins yet.</td></tr>';
      } else {
        tbody.innerHTML = attendees.map(at => {
          const time = new Date(at.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `<tr><td>${at.name}</td><td>${at.employee_id}</td><td>${time}</td></tr>`;
        }).join('');
      }

      // Export Attendees CSV button
      document.getElementById('host-export-csv').onclick = () => {
        if (attendees.length === 0) {
          this.showToast('No attendees to export', 'error');
          return;
        }
        const headers = ['Employee ID', 'Name', 'Check-in Time'];
        const rows = attendees.map(at => [at.employee_id, at.name, new Date(at.check_in).toLocaleString()]);
        const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${event.name}_attendees.csv`;
        a.click();
      };

    } catch (e) {
      this.showToast('Failed to load event details', 'error');
    }
  },

  async renderAttendeeDashboard() {
    const totalEl = document.getElementById('attendee-total-checkins');
    const statusEl = document.getElementById('attendee-sync-status');
    const tbody = document.getElementById('attendee-logs-tbody');

    // Self Profile Section
    const nameEl = document.getElementById('attendee-profile-name');
    const idEl = document.getElementById('attendee-profile-id');
    const avatarEl = document.getElementById('attendee-profile-avatar');

    if (nameEl) nameEl.textContent = this.user.username || this.user.name;
    if (idEl) idEl.textContent = `Username: ${this.user.username || 'Self'}`;
    if (avatarEl) {
      if (this.user.avatar) {
        avatarEl.innerHTML = `<img src="${this.user.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
      } else {
        avatarEl.textContent = (this.user.username || 'U').charAt(0).toUpperCase();
      }
    }

    try {
      const allRecords = await API.getAttendance();
      totalEl.textContent = allRecords.length;

      const offlineQueue = await DB.getOfflineQueue();
      if (offlineQueue.length > 0) {
        statusEl.textContent = `${offlineQueue.length} Queued Offline`;
        statusEl.style.color = '#f59e0b';
      } else {
        statusEl.textContent = 'Fully Synced';
        statusEl.style.color = '#10b981';
      }

      if (allRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-secondary)">No logs available.</td></tr>';
      } else {
        tbody.innerHTML = allRecords.slice(0, 10).map(r => {
          const inTime = new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const outTime = r.check_out ? new Date(r.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
          return `<tr><td>${r.date}</td><td>${inTime}</td><td>${outTime}</td></tr>`;
        }).join('');
      }
    } catch (e) {
      console.warn('Could not populate attendee logs dashboard', e);
    }
  },

  renderUsers() {
    const hostsGrid = document.getElementById('hosts-grid');
    const attendeesGrid = document.getElementById('attendees-grid');
    const hostCountEl = document.getElementById('host-count');
    const attendeeCountEl = document.getElementById('attendee-count');
    
    const hosts = this.users.filter(u => u.role === 'host');
    const attendees = this.users.filter(u => u.role === 'attendee');

    hostCountEl.textContent = hosts.length;
    attendeeCountEl.textContent = attendees.length;

    const renderCard = (u) => `
      <div class="user-card">
        <div class="user-avatar">${u.image_data ? `<img src="${u.image_data}" alt="">` : u.name.charAt(0)}</div>
        <h4>${u.name}</h4>
        <p>${u.employee_id}</p>
        <button class="btn btn-danger" onclick="App.deleteUser(${u.id})">Delete</button>
      </div>
    `;

    if (hosts.length === 0) {
      hostsGrid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;grid-column:1/-1;">No hosts registered</p>';
    } else {
      hostsGrid.innerHTML = hosts.map(renderCard).join('');
    }

    if (attendees.length === 0) {
      attendeesGrid.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:20px;grid-column:1/-1;">No attendees registered</p>';
    } else {
      attendeesGrid.innerHTML = attendees.map(renderCard).join('');
    }
  },

  async deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    try {
      await API.deleteUser(id);
      this.showToast('User deleted');
      await this.loadData();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  setupLogs() {
    document.getElementById('log-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('log-date').addEventListener('change', () => this.renderLogs());
    document.getElementById('log-user').addEventListener('change', () => this.renderLogs());
    document.getElementById('export-btn').addEventListener('click', () => this.exportCSV());
  },

  populateUserFilter() {
    const select = document.getElementById('log-user');
    select.innerHTML = '<option value="">All Users</option>' + 
      this.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  },

  async renderLogs() {
    const tbody = document.getElementById('logs-tbody');
    const date = document.getElementById('log-date').value;
    const userId = document.getElementById('log-user').value;
    
    try {
      const records = await API.getAttendance({ date, userId: userId || undefined });
      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">No records found</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        const checkIn = new Date(r.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const checkOut = r.check_out ? new Date(r.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
        let duration = '-';
        if (r.check_in && r.check_out) {
          const mins = Math.round((new Date(r.check_out) - new Date(r.check_in)) / 60000);
          duration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }
        return `<tr><td>${r.date}</td><td>${r.name}</td><td>${r.event_name || 'General'}</td><td>${checkIn}</td><td>${checkOut}</td><td>${duration}</td></tr>`;
      }).join('');
    } catch (e) { this.showToast('Failed to load logs', 'error'); }
  },

  async exportCSV() {
    try {
      const records = await API.exportAttendance();
      const headers = ['Date', 'Employee ID', 'Name', 'Event Name', 'Check In', 'Check Out'];
      const rows = records.map(r => [
        r.date, r.employee_id, r.name, r.event_name || 'General',
        new Date(r.check_in).toLocaleString(),
        r.check_out ? new Date(r.check_out).toLocaleString() : ''
      ]);
      const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      this.showToast('Exported', 'success');
    } catch (e) { this.showToast('Export failed', 'error'); }
  },

  navigateTo(tab) {
    const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
    if (btn) {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tab).classList.add('active');
      
      this.stopAttendanceCamera();
      this.stopHostCamera();
      this.stopRegisterModalCamera();
      this.stopRegisterCamera();

      if (tab === 'attendance') {
        document.getElementById('start-scanning-btn').classList.remove('hidden');
        document.getElementById('stop-scanning-btn').classList.add('hidden');
        document.getElementById('status-badge').textContent = 'Select event or scan QR code to start';
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('auth') === 'success') {
  window.history.replaceState({}, '', '/');
  setTimeout(() => App.checkAuth(), 100);
}
