<script>
  import { onMount, onDestroy } from 'svelte';
  import QrScanner from 'qr-scanner';
  import { initMediaPipe, detectFaces, getPlanarFacePixels, drawFaceBox } from '$lib/face.js';
  import API from '$lib/api.js';
  import DB from '$lib/db.js';

  // Svelte 5 states (runes)
  let user = $state(null);
  let activeTab = $state('attendance');
  let events = $state([]);
  let selectedEventId = $state('');
  let activeEvent = $derived(events.find(e => e.id == selectedEventId) || null);
  
  // UI states
  let isMenuOpen = $state(false);
  let showLoginModal = $state(false);
  let loginTab = $state('login');
  let toastMsg = $state('');
  let toastType = $state('');
  let toastTimeout = null;
  let loadingMsg = $state('');

  // Forms
  let loginUsername = $state('');
  let loginPassword = $state('');
  let regUsername = $state('');
  let regPassword = $state('');
  let regConfirm = $state('');
  let regEmployeeId = $state('');
  let regRole = $state('attendee');

  let newEventName = $state('');
  let newEventRadius = $state(100);
  let newEventLocSource = $state('current');
  let newEventLat = $state('');
  let newEventLon = $state('');

  let regFormEmpId = $state('');
  let regFormName = $state('');
  let regFormRole = $state('attendee');

  // History & Admin states
  let logsDate = $state('');
  let logsUserId = $state('');
  let logs = $state([]);
  let allUsers = $state([]);
  let hostEvents = $derived(events.filter(e => e.host_id == user?.id));
  let selectedManagedEventId = $state('');
  let managedEvent = $derived(events.find(e => e.id == selectedManagedEventId) || null);
  let managedEventAttendees = $state([]);

  // Camera trackers
  let videoEl = $state(null);
  let overlayEl = $state(null);
  let isCameraActive = $state(false);

  let hostVideoEl = $state(null);
  let isHostCameraActive = $state(false);
  let capturedHostPlanar = $state(null);
  let capturedHostImgData = $state(null);

  let registerVideoEl = $state(null);
  let isRegisterCameraActive = $state(false);
  let capturedRegPlanar = $state(null);
  let capturedRegImgData = $state(null);

  let modalVideoEl = $state(null);
  let isModalCameraActive = $state(false);
  let capturedModalPlanar = $state(null);
  let capturedModalImgData = $state(null);

  // Recognition trackers
  let statusText = $state('Select event or scan QR code to start');
  let recognizedUserName = $state('');
  let recognizedUserStatus = $state('Waiting for face...');
  let todayAttendance = $state([]);
  let isCooldown = false;
  let lastScannedQRToken = $state(null);
  let activeQRToken = $state(null);

  let detectionInterval = null;
  let qrScannerInstance = null;
  let attendanceUsers = $state([]);

  // Toast helper
  function showToast(msg, type = 'success') {
    toastMsg = msg;
    toastType = type;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastMsg = '';
    }, 4000);
  }

  // Load static data
  async function loadData() {
    if (navigator.onLine) {
      await syncOfflineQueue();
    }
    try {
      // Get all events
      events = await API.getEvents();
    } catch (e) {
      console.warn('Failed to load events', e);
    }
    try {
      const today = new Date().toISOString().split('T')[0];
      todayAttendance = await API.getAttendance({ date: today });
    } catch (e) {
      console.warn('Failed to load today logs', e);
    }
    if (user) {
      try {
        allUsers = await API.getUsers();
      } catch (e) {
        console.warn('Failed to load users list', e);
      }
      try {
        logs = await API.getAttendance();
      } catch (e) {
        console.warn('Failed to load historical logs', e);
      }
    }
  }

  // Sync offline Dexie queue
  async function syncOfflineQueue() {
    try {
      const queue = await DB.getOfflineQueue();
      if (queue.length === 0) return;
      console.log('Online detected. Syncing offline records...', queue);
      for (const rec of queue) {
        await API.recordAttendance(
          rec.planarArray,
          rec.qrToken,
          rec.eventId,
          rec.latitude,
          rec.longitude,
          rec.offlineUuid,
          rec.timestamp
        );
        await DB.deleteFromOfflineQueue(rec.id);
      }
      showToast('Offline records successfully synchronized with cloud!', 'success');
      // reload logs after sync
      const today = new Date().toISOString().split('T')[0];
      todayAttendance = await API.getAttendance({ date: today });
    } catch (err) {
      console.warn('Sync failed:', err);
    }
  }

  // Auth profile loader
  async function checkUser() {
    try {
      user = await API.getMe();
      await loadData();
    } catch (e) {
      user = null;
    }
  }

  // Login handler
  async function handleLogin(e) {
    e.preventDefault();
    loadingMsg = 'Authenticating...';
    try {
      user = await API.localLogin(loginUsername, loginPassword);
      showLoginModal = false;
      loginUsername = '';
      loginPassword = '';
      showToast('Logged in successfully', 'success');
      await loadData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      loadingMsg = '';
    }
  }

  // Register local account
  async function handleRegister(e) {
    e.preventDefault();
    if (regPassword !== regConfirm) {
      showToast('Passwords do not match', 'error');
      return;
    }
    if (!capturedModalPlanar) {
      showToast('Face verification scan is required to register', 'error');
      return;
    }
    loadingMsg = 'Registering...';
    try {
      user = await API.localRegister(
        regUsername,
        regPassword,
        regRole,
        regEmployeeId,
        Array.from(capturedModalPlanar),
        capturedModalImgData,
        regUsername
      );
      showLoginModal = false;
      regUsername = '';
      regPassword = '';
      regConfirm = '';
      regEmployeeId = '';
      stopModalCamera();
      showToast('Account registered successfully', 'success');
      await loadData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      loadingMsg = '';
    }
  }

  // Logout handler
  async function handleLogout() {
    try {
      await API.localLogout();
      user = null;
      activeTab = 'attendance';
      showToast('Logged out', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Start checking camera
  async function startAttendanceCamera() {
    try {
      if (qrScannerInstance) {
        qrScannerInstance.destroy();
      }

      qrScannerInstance = new QrScanner(
        videoEl,
        async result => {
          const data = result.data;
          if (data.includes('qr=')) {
            let qrToken = null;
            try {
              const url = new URL(data);
              qrToken = url.searchParams.get('qr');
            } catch(e) {
              qrToken = data.split('qr=')[1];
            }
            if (qrToken && lastScannedQRToken !== qrToken) {
              lastScannedQRToken = qrToken;
              activeQRToken = qrToken;
              statusText = 'Analyzing QR Code...';
              
              // Decode token
              try {
                if (qrToken.includes('.')) {
                  const base64Url = qrToken.split('.')[1];
                  if (base64Url) {
                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    const decoded = JSON.parse(atob(base64));
                    selectedEventId = decoded.eventId;
                  }
                } else {
                  selectedEventId = qrToken;
                }
                await loadData();
                showToast('Event selected from QR Code!', 'success');
              } catch(e) {
                console.error('QR parsing error:', e);
              }
            }
          }
        },
        {
          onDecodeError: () => {},
          calculateScanRegion: (v) => {
            const size = Math.floor(Math.min(v.videoWidth, v.videoHeight) * 0.60);
            return {
              x: Math.floor((v.videoWidth - size) / 2),
              y: Math.floor((v.videoHeight - size) / 2),
              width: size,
              height: size
            };
          },
          highlightScanRegion: true,
          highlightCodeOutline: true
        }
      );

      await qrScannerInstance.start();
      isCameraActive = true;

      // Adjust overlay dimensions on video stream playing
      videoEl.addEventListener('playing', () => {
        if (overlayEl) {
          overlayEl.width = videoEl.videoWidth || 640;
          overlayEl.height = videoEl.videoHeight || 480;
        }
      }, { once: true });

      startFaceDetectionLoop();
      showToast('Camera active. Scan QR code or select event.', 'success');
    } catch (err) {
      console.error(err);
      showToast('Camera access denied or failed to initialize', 'error');
    }
  }

  // Stop camera
  function stopAttendanceCamera() {
    isCameraActive = false;
    if (detectionInterval) clearInterval(detectionInterval);
    if (qrScannerInstance) {
      qrScannerInstance.destroy();
      qrScannerInstance = null;
    }
    if (overlayEl) {
      const ctx = overlayEl.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    }
  }

  // Draw local camera reticles & sweeps
  function drawOverlayReticle(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const boxSize = Math.min(width, height) * 0.55;
    const x = (width - boxSize) / 2;
    const y = (height - boxSize) / 2;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    // Corner brackets
    ctx.beginPath();
    ctx.moveTo(x, y + 24); ctx.lineTo(x, y); ctx.lineTo(x + 24, y);
    ctx.moveTo(x + boxSize, y + 24); ctx.lineTo(x + boxSize, y); ctx.lineTo(x + boxSize - 24, y);
    ctx.moveTo(x, y + boxSize - 24); ctx.lineTo(x, y + boxSize); ctx.lineTo(x + 24, y + boxSize);
    ctx.moveTo(x + boxSize, y + boxSize - 24); ctx.lineTo(x + boxSize, y + boxSize); ctx.lineTo(x + boxSize - 24, y + boxSize);
    ctx.stroke();

    // Moving laser sweep
    const laserY = y + (Math.sin(performance.now() * 0.003) * 0.5 + 0.5) * boxSize;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x + 6, laserY);
    ctx.lineTo(x + boxSize - 6, laserY);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Main matching loop
  let livenessTicks = 0;
  function startFaceDetectionLoop() {
    if (detectionInterval) clearInterval(detectionInterval);
    detectionInterval = setInterval(async () => {
      if (isCooldown || !isCameraActive) return;

      try {
        const detections = await detectFaces(videoEl);
        if (!overlayEl) return;
        const ctx = overlayEl.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
          drawOverlayReticle(overlayEl);
        }

        if (!selectedEventId) {
          statusText = 'Align Event QR Code in Scanner';
          recognizedUserStatus = 'Select event to begin';
          return;
        }

        if (detections.length === 0) {
          statusText = 'Position your face';
          recognizedUserStatus = 'Waiting for face...';
          recognizedUserName = '';
          livenessTicks = 0;
          return;
        }

        if (detections.length === 1) {
          const d = detections[0];
          drawFaceBox(overlayEl, d.boundingBox, '#3b82f6');
          livenessTicks++;

          if (livenessTicks < 6) {
            statusText = `Verifying liveness... (${livenessTicks}/6)`;
            recognizedUserStatus = 'Detecting movements...';
            return;
          }

          statusText = 'Liveness Verified';
          recognizedUserStatus = 'Recognizing...';

          // Extract planar face pixels and POST
          const pixels = getPlanarFacePixels(videoEl, d.boundingBox);
          isCooldown = true;
          
          try {
            const coords = await getGPSCoordinates();
            let res;
            try {
              res = await API.recordAttendance(
                Array.from(pixels),
                activeQRToken,
                selectedEventId,
                coords.latitude,
                coords.longitude
              );
              recognizedUserName = res.user.name;
              recognizedUserStatus = `Checked ${res.type} successfully!`;
              showToast(`Recorded check-${res.type} for ${res.user.name}`, 'success');
            } catch (fetchErr) {
              // Network/Connection failure -> save to local queue
              if (!navigator.onLine || fetchErr.message.includes('Failed to fetch') || fetchErr.message.includes('NetworkError')) {
                const offlineUuid = crypto.randomUUID();
                const timestamp = new Date().toISOString();
                await DB.addToOfflineQueue({
                  planarArray: Array.from(pixels),
                  qrToken: activeQRToken,
                  eventId: selectedEventId,
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  offlineUuid,
                  timestamp
                });
                recognizedUserName = 'Offline Check-in';
                recognizedUserStatus = 'Saved locally. Will sync when connection is restored.';
                showToast('Offline mode: Saved check-in details locally', 'warning');
              } else {
                throw fetchErr;
              }
            }
            await loadData();
          } catch(e) {
            showToast(e.message, 'error');
            recognizedUserStatus = e.message;
          } finally {
            livenessTicks = 0;
            setTimeout(() => {
              isCooldown = false;
            }, 4000);
          }
        } else {
          statusText = 'Multiple Faces';
          recognizedUserStatus = 'Ensure only one person is in view';
        }
      } catch (err) {
        console.error(err);
      }
    }, 200);
  }

  // Fetch coordinates
  function getGPSCoordinates() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ latitude: null, longitude: null });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve({ latitude: null, longitude: null }),
        { timeout: 5000 }
      );
    });
  }

  // Upload QR from image file
  async function handleQRUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const decoded = await QrScanner.scanImage(file);
      if (decoded.includes('qr=')) {
        const qrToken = decoded.split('qr=')[1];
        activeQRToken = qrToken;
        const base64Url = qrToken.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const decodedPayload = JSON.parse(atob(base64));
        selectedEventId = decodedPayload.eventId;
        await loadData();
        showToast('Event QR image parsed successfully!', 'success');
      }
    } catch(err) {
      showToast('Failed to parse QR file image: ' + err.message, 'error');
    }
  }

  // Host face scanning (when creating events)
  async function startHostCamera() {
    capturedHostPlanar = null;
    capturedHostImgData = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      hostVideoEl.srcObject = stream;
      await hostVideoEl.play();
      isHostCameraActive = true;
    } catch (e) {
      showToast('Failed to open scan camera', 'error');
    }
  }

  function stopHostCamera() {
    if (hostVideoEl && hostVideoEl.srcObject) {
      hostVideoEl.srcObject.getTracks().forEach(t => t.stop());
      hostVideoEl.srcObject = null;
    }
    isHostCameraActive = false;
  }

  async function captureHostFace() {
    try {
      const detections = await detectFaces(hostVideoEl);
      if (detections.length !== 1) {
        showToast('Please position exactly one face in the crop box', 'error');
        return;
      }
      const d = detections[0];
      const pixels = getPlanarFacePixels(hostVideoEl, d.boundingBox);
      capturedHostPlanar = pixels;

      const canvas = document.createElement('canvas');
      canvas.width = 112;
      canvas.height = 112;
      canvas.getContext('2d').drawImage(hostVideoEl, d.boundingBox.originX, d.boundingBox.originY, d.boundingBox.width, d.boundingBox.height, 0, 0, 112, 112);
      capturedHostImgData = canvas.toDataURL('image/jpeg');
      stopHostCamera();
      showToast('Host face model scanned', 'success');
    } catch(e) {
      showToast(e.message, 'error');
    }
  }

  // Admin creating a new event
  async function handleCreateEvent(e) {
    e.preventDefault();
    if (!capturedHostPlanar) {
      showToast('Please complete a host identity face scan first', 'error');
      return;
    }
    loadingMsg = 'Creating event...';
    try {
      let lat = parseFloat(newEventLat);
      let lon = parseFloat(newEventLon);

      if (newEventLocSource === 'current') {
        const coords = await getGPSCoordinates();
        lat = coords.latitude;
        lon = coords.longitude;
      }

      if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) {
        showToast('GPS coordinates are required', 'error');
        return;
      }

      const ev = await API.createEvent({
        name: newEventName,
        latitude: lat,
        longitude: lon,
        radius_meters: parseFloat(newEventRadius),
        host_image: capturedHostImgData
      });

      showToast(`Created event: ${ev.name}`, 'success');
      newEventName = '';
      capturedHostPlanar = null;
      capturedHostImgData = null;
      await loadData();
      activeTab = 'manage-events';
    } catch(err) {
      showToast(err.message, 'error');
    } finally {
      loadingMsg = '';
    }
  }

  // Admin registration form face scan
  async function startModalCamera() {
    capturedModalPlanar = null;
    capturedModalImgData = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      modalVideoEl.srcObject = stream;
      await modalVideoEl.play();
      isModalCameraActive = true;
    } catch (e) {
      showToast('Failed to open modal camera', 'error');
    }
  }

  function stopModalCamera() {
    if (modalVideoEl && modalVideoEl.srcObject) {
      modalVideoEl.srcObject.getTracks().forEach(t => t.stop());
      modalVideoEl.srcObject = null;
    }
    isModalCameraActive = false;
  }

  async function captureModalFace() {
    try {
      const detections = await detectFaces(modalVideoEl);
      if (detections.length !== 1) {
        showToast('Please position exactly one face in the frame', 'error');
        return;
      }
      const d = detections[0];
      const pixels = getPlanarFacePixels(modalVideoEl, d.boundingBox);
      capturedModalPlanar = pixels;

      const canvas = document.createElement('canvas');
      canvas.width = 112;
      canvas.height = 112;
      canvas.getContext('2d').drawImage(modalVideoEl, d.boundingBox.originX, d.boundingBox.originY, d.boundingBox.width, d.boundingBox.height, 0, 0, 112, 112);
      capturedModalImgData = canvas.toDataURL('image/jpeg');
      stopModalCamera();
      showToast('Verification face model captured', 'success');
    } catch(e) {
      showToast(e.message, 'error');
    }
  }

  // Admin register new users from Users dashboard
  async function handleAdminRegister(e) {
    e.preventDefault();
    if (!capturedRegPlanar) {
      showToast('Please capture user verification face first', 'error');
      return;
    }
    loadingMsg = 'Registering new user...';
    try {
      await API.createUser({
        employeeId: regFormEmpId,
        name: regFormName,
        role: regFormRole,
        planarArray: Array.from(capturedRegPlanar),
        imageData: capturedRegImgData
      });
      showToast(`Registered user: ${regFormName}`, 'success');
      regFormEmpId = '';
      regFormName = '';
      capturedRegPlanar = null;
      capturedRegImgData = null;
      await loadData();
    } catch(err) {
      showToast(err.message, 'error');
    } finally {
      loadingMsg = '';
    }
  }

  async function startRegisterCamera() {
    capturedRegPlanar = null;
    capturedRegImgData = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      registerVideoEl.srcObject = stream;
      await registerVideoEl.play();
      isRegisterCameraActive = true;
    } catch (e) {
      showToast('Failed to open registration camera', 'error');
    }
  }

  function stopRegisterCamera() {
    if (registerVideoEl && registerVideoEl.srcObject) {
      registerVideoEl.srcObject.getTracks().forEach(t => t.stop());
      registerVideoEl.srcObject = null;
    }
    isRegisterCameraActive = false;
  }

  async function captureRegisterFace() {
    try {
      const detections = await detectFaces(registerVideoEl);
      if (detections.length !== 1) {
        showToast('Verify face presence failed', 'error');
        return;
      }
      const d = detections[0];
      const pixels = getPlanarFacePixels(registerVideoEl, d.boundingBox);
      capturedRegPlanar = pixels;

      const canvas = document.createElement('canvas');
      canvas.width = 112;
      canvas.height = 112;
      canvas.getContext('2d').drawImage(registerVideoEl, d.boundingBox.originX, d.boundingBox.originY, d.boundingBox.width, d.boundingBox.height, 0, 0, 112, 112);
      capturedRegImgData = canvas.toDataURL('image/jpeg');
      stopRegisterCamera();
      showToast('Registration face captured', 'success');
    } catch(e) {
      showToast(e.message, 'error');
    }
  }

  // Admin delete users
  async function handleDeleteUser(id) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await API.deleteUser(id);
      showToast('User deleted successfully', 'success');
      await loadData();
    } catch(e) {
      showToast(e.message, 'error');
    }
  }

  // Export CSV
  async function exportHistoryCSV() {
    try {
      const records = await API.exportAttendance();
      if (records.length === 0) {
        showToast('No records available to export', 'error');
        return;
      }
      const headers = ['Employee ID', 'Name', 'Date', 'Check In', 'Check Out', 'Event Name'];
      const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(',')].concat(
            records.map(r => [
              r.employee_id,
              `"${r.name}"`,
              r.date.split('T')[0],
              r.check_in ? new Date(r.check_in).toLocaleTimeString() : '',
              r.check_out ? new Date(r.check_out).toLocaleTimeString() : '',
              `"${r.event_name || 'N/A'}"`
            ].join(','))
          ).join('\n');
      
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", `attendance_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch(e) {
      showToast(e.message, 'error');
    }
  }

  // Host export specific event CSV
  async function exportEventCSV(eventId, eventName) {
    try {
      const records = await API.request(`/api/events/${eventId}/attendance`);
      if (records.length === 0) {
        showToast('No check-ins logged for this event', 'error');
        return;
      }
      const headers = ['Employee ID', 'Name', 'Date', 'Check In', 'Check Out'];
      const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(',')].concat(
            records.map(r => [
              r.employee_id,
              `"${r.name}"`,
              r.date.split('T')[0],
              r.check_in ? new Date(r.check_in).toLocaleTimeString() : '',
              r.check_out ? new Date(r.check_out).toLocaleTimeString() : ''
            ].join(','))
          ).join('\n');
      
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", `event_${eventName}_export.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch(e) {
      showToast(e.message, 'error');
    }
  }

  onMount(async () => {
    await checkUser();
    await initMediaPipe();
    await DB.init();
    
    // Set up auto-sync on online status restoration
    window.addEventListener('online', syncOfflineQueue);
  });

  onDestroy(() => {
    stopAttendanceCamera();
    stopHostCamera();
    stopRegisterCamera();
    stopModalCamera();
  });
</script>

<svelte:head>
  <title>FaceTrack - Face Attendance System</title>
</svelte:head>

<div id="app">
  <nav class="navbar">
    <a href="/" class="logo" onclick={(e) => { e.preventDefault(); activeTab = 'attendance'; }}>FaceTrack</a>
    <button class="menu-toggle" class:active={isMenuOpen} onclick={() => isMenuOpen = !isMenuOpen} aria-label="Menu">
      <span></span>
      <span></span>
      <span></span>
    </button>
    <div class="nav-links" class:show={isMenuOpen}>
      <button class="nav-btn" class:active={activeTab === 'attendance'} onclick={() => { activeTab = 'attendance'; isMenuOpen = false; }}>Attendance</button>
      
      {#if user}
        {#if user.role === 'host' || user.role === 'admin'}
          <button class="nav-btn" class:active={activeTab === 'create-event'} onclick={() => { activeTab = 'create-event'; isMenuOpen = false; }}>Create Event</button>
          <button class="nav-btn" class:active={activeTab === 'manage-events'} onclick={() => { activeTab = 'manage-events'; isMenuOpen = false; }}>Manage Events</button>
        {/if}
        {#if user.role === 'attendee'}
          <button class="nav-btn" class:active={activeTab === 'attendee-dashboard'} onclick={() => { activeTab = 'attendee-dashboard'; isMenuOpen = false; }}>Dashboard</button>
        {/if}
        {#if user.role === 'admin'}
          <button class="nav-btn" class:active={activeTab === 'register'} onclick={() => { activeTab = 'register'; isMenuOpen = false; }}>Register User</button>
          <button class="nav-btn" class:active={activeTab === 'users'} onclick={() => { activeTab = 'users'; isMenuOpen = false; }}>Users</button>
          <button class="nav-btn" class:active={activeTab === 'logs'} onclick={() => { activeTab = 'logs'; isMenuOpen = false; }}>History</button>
        {/if}
      {/if}
    </div>
    
    <div class="user-section">
      {#if user}
        <div id="user-info">
          <span>{user.username}</span>
          <span id="admin-badge">{user.role.toUpperCase()}</span>
        </div>
        <button onclick={handleLogout} class="btn btn-ghost">Logout</button>
      {:else}
        <button onclick={() => showLoginModal = true} class="btn btn-primary">Login</button>
      {/if}
    </div>
  </nav>

  <main class="main-content">
    <!-- Attendance View -->
    {#if activeTab === 'attendance'}
      <section id="attendance" class="tab-content active">
        <div class="camera-container">
          <div class="video-wrapper">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={videoEl} autoplay muted playsinline></video>
            <canvas bind:this={overlayEl}></canvas>
            <div class="status-badge" id="status-badge">{statusText}</div>
          </div>
          <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            {#if !isCameraActive}
              <button onclick={startAttendanceCamera} class="btn btn-primary" style="padding: 10px 20px;">Start Camera</button>
            {:else}
              <button onclick={stopAttendanceCamera} class="btn btn-ghost" style="padding: 10px 20px;">Stop Camera</button>
            {/if}
          </div>
        </div>
        
        <div class="attendance-sidebar">
          <div class="card">
            <h3>Event Context</h3>
            <div class="form-group" style="margin-top: 10px;">
              <select bind:value={selectedEventId} class="form-select">
                <option value="">-- Select Event --</option>
                {#each events as ev}
                  <option value={ev.id}>{ev.name}</option>
                {/each}
              </select>
            </div>
            
            {#if activeEvent}
              <div id="active-event-display" style="margin-top: 10px; padding: 10px; border-radius: 6px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); text-align: center;">
                <span style="font-size: 11px; color: var(--text-secondary); display: block;">ACTIVE SELECTION</span>
                <strong style="font-size: 14px; color: var(--primary-color);">{activeEvent.name}</strong>
              </div>
              
              <div id="event-creator-details" style="margin-top: 15px; text-align: center; padding-top: 15px; border-top: 1px solid var(--border-color);">
                <h4 style="font-size: 13px; color: var(--text-secondary); margin-bottom: 2px;">Event Creator</h4>
                {#if activeEvent.host_image}
                  <img id="creator-host-avatar" src={activeEvent.host_image} alt="Host Avatar" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover; border: 2px solid var(--primary-color); margin: 6px auto;">
                {/if}
                <div id="creator-host-name" style="font-weight: 600; font-size: 14px; color: var(--text-primary);">{activeEvent.host_name || 'Host'}</div>
                
                <h4 style="font-size: 13px; color: var(--text-secondary); margin-top: 12px; margin-bottom: 2px;">Event Bounds</h4>
                <div id="event-location-display" style="font-size: 12px; color: var(--text-primary); font-family: monospace;">
                  Lat: {parseFloat(activeEvent.latitude).toFixed(4)}<br>Lon: {parseFloat(activeEvent.longitude).toFixed(4)}<br>Radius: {activeEvent.radius_meters}m
                </div>
              </div>
            {/if}
            
            <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 10px;">
              <div style="font-size: 11px; text-align: center; color: var(--text-secondary);">OR upload QR Code image file below:</div>
              <input type="file" onchange={handleQRUpload} accept="image/*" style="font-size: 12px; width: 100%;">
            </div>
          </div>

          <div class="card">
            <h3>Recognized User</h3>
            <div class="detected-user">
              {#if recognizedUserName}
                <div class="name">{recognizedUserName}</div>
                <div class="status">{recognizedUserStatus}</div>
              {:else}
                <span class="placeholder">{recognizedUserStatus}</span>
              {/if}
            </div>
          </div>
          
          <div class="card">
            <h3>Today's Attendance</h3>
            <div class="attendance-list">
              {#each todayAttendance as log}
                <div class="attendance-item">
                  <div>
                    <strong>{log.name}</strong>
                    <span style="font-size: 11px; color: var(--text-secondary); display: block;">{log.event_name || 'Generic'}</span>
                  </div>
                  <div style="text-align: right;">
                    <span style="color: #10b981;">{new Date(log.check_in).toLocaleTimeString()}</span>
                    {#if log.check_out}
                      <span style="color: #ef4444; font-size: 11px; display: block;">Out: {new Date(log.check_out).toLocaleTimeString()}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Create Event -->
    {#if activeTab === 'create-event'}
      <section id="create-event" class="tab-content active">
        <div style="max-width: 600px; margin: 0 auto;">
          <div class="card">
            <h3>Create Event</h3>
            <form onsubmit={handleCreateEvent} class="form" style="margin-top: 15px;">
              <div class="form-group">
                <label for="new-event-name">Event Name</label>
                <input bind:value={newEventName} type="text" id="new-event-name" required placeholder="Workshop/Lecture Name">
              </div>
              <div class="form-group">
                <label for="new-event-radius">Radius (Meters)</label>
                <input bind:value={newEventRadius} type="number" id="new-event-radius" required min="10">
              </div>
              <div class="form-group">
                <label for="new-event-location-source">Location Setting</label>
                <select bind:value={newEventLocSource} id="new-event-location-source" class="form-select">
                  <option value="current">Use Current GPS Location</option>
                  <option value="custom">Use Custom Coordinates</option>
                </select>
              </div>
              
              {#if newEventLocSource === 'custom'}
                <div>
                  <div class="form-group">
                    <label for="new-event-lat">Latitude</label>
                    <input bind:value={newEventLat} type="number" id="new-event-lat" step="any" required placeholder="e.g. 37.7749">
                  </div>
                  <div class="form-group">
                    <label for="new-event-lon">Longitude</label>
                    <input bind:value={newEventLon} type="number" id="new-event-lon" step="any" required placeholder="e.g. -122.4194">
                  </div>
                </div>
              {/if}
              
              <div class="form-group" style="margin-top: 15px;">
                <label for="host-scan-video">Host Identity Scan (Verify Face)</label>
                <div class="video-wrapper small" style="position: relative; height: 160px; border-radius: 6px; overflow: hidden; background: #000; margin-bottom: 10px;">
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video bind:this={hostVideoEl} autoplay muted playsinline style="width:100%; height:100%; object-fit: cover;"></video>
                </div>
                <div style="display: flex; gap: 10px;">
                  {#if !isHostCameraActive}
                    <button type="button" onclick={startHostCamera} class="btn btn-ghost">Start Camera</button>
                  {:else}
                    <button type="button" onclick={captureHostFace} class="btn btn-primary">Scan Face</button>
                    <button type="button" onclick={stopHostCamera} class="btn btn-ghost">Stop</button>
                  {/if}
                </div>
                {#if capturedHostImgData}
                  <div style="margin-top: 10px;">
                    <img src={capturedHostImgData} alt="Face Scan Preview" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover; border: 2px solid var(--primary-color);">
                  </div>
                {/if}
              </div>
              <button type="submit" class="btn btn-primary btn-full" style="margin-top: 15px;">Create Event</button>
            </form>
          </div>
        </div>
      </section>
    {/if}

    <!-- Manage Events -->
    {#if activeTab === 'manage-events'}
      <section id="manage-events" class="tab-content active">
        <div style="display: flex; flex-direction: column; gap: 20px;">
          <div class="card">
            <h3>My Created Events</h3>
            <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 12px;">
              {#each hostEvents as ev}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="event-item" class:active={selectedManagedEventId == ev.id} onclick={async () => {
                  selectedManagedEventId = ev.id;
                  try {
                    managedEventAttendees = await API.request(`/api/events/${ev.id}/attendance`);
                  } catch (e) {
                    showToast(e.message, 'error');
                  }
                }} style="padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; cursor: pointer;">
                  <strong>{ev.name}</strong>
                  <span style="font-size: 11px; color: var(--text-secondary); display: block;">Radius: {ev.radius_meters}m</span>
                </div>
              {/each}
              {#if hostEvents.length === 0}
                <span class="placeholder">No events created yet.</span>
              {/if}
            </div>
          </div>
          
          <div class="card">
            {#if managedEvent}
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <h3>Manage: {managedEvent.name}</h3>
                  <button onclick={() => exportEventCSV(managedEvent.id, managedEvent.name)} class="btn btn-ghost btn-sm">Export (CSV)</button>
                </div>
                
                <div style="text-align: center; margin: 15px 0;">
                  <div style="display: inline-block; padding: 10px; background: white; border-radius: 6px;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={encodeURIComponent(window.location.origin + '/?qr=' + managedEvent.id)}" alt="QR Code">
                  </div>
                  <div style="margin-top: 8px;">
                    <!-- svelte-ignore a11y_missing_attribute -->
                    <a href="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={encodeURIComponent(window.location.origin + '/?qr=' + managedEvent.id)}" target="_blank" download class="btn btn-ghost btn-sm">Download QR Code</a>
                  </div>
                </div>
                
                <h4 style="margin-top: 15px;">Checked-in Attendees</h4>
                <div class="table-wrapper" style="margin-top: 10px;">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>ID</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each managedEventAttendees as att}
                        <tr>
                          <td>{att.name}</td>
                          <td>{att.employee_id}</td>
                          <td>{new Date(att.check_in).toLocaleTimeString()}</td>
                        </tr>
                      {:else}
                        <tr><td colspan="3" style="text-align:center; color: var(--text-secondary)">No check-ins yet.</td></tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {:else}
              <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                Select an event from the list to view details and manage check-ins.
              </div>
            {/if}
          </div>
        </div>
      </section>
    {/if}

    <!-- Attendee Dashboard -->
    {#if activeTab === 'attendee-dashboard'}
      <section id="attendee-dashboard" class="tab-content active">
        <div style="display: flex; flex-direction: column; gap: 20px;">
          <div class="card">
            <h3>My Profile Details</h3>
            <div style="display: flex; align-items: center; gap: 15px; margin-top: 15px;">
              <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 700; color: var(--primary-color); overflow: hidden;">
                {user?.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 style="margin: 0; font-size: 18px; color: var(--text-primary);">{user?.username}</h4>
                <p style="margin: 3px 0 0 0; color: var(--text-secondary); font-size: 14px;">User ID: #{user?.id}</p>
                <p style="margin: 3px 0 0 0; font-size: 12px; font-weight: 600; color: var(--primary-color);">{user?.role.toUpperCase()}</p>
              </div>
            </div>
          </div>
          
          <div class="card">
            <h3>My Attendance History</h3>
            <div class="table-wrapper" style="margin-top: 15px;">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                  </tr>
                </thead>
                <tbody>
                  {#each logs as log}
                    <tr>
                      <td>{log.date.split('T')[0]}</td>
                      <td>{new Date(log.check_in).toLocaleTimeString()}</td>
                      <td>{log.check_out ? new Date(log.check_out).toLocaleTimeString() : '--'}</td>
                    </tr>
                  {:else}
                    <tr><td colspan="3" style="text-align:center; color: var(--text-secondary)">No logs available.</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Admin Registration -->
    {#if activeTab === 'register'}
      <section id="register" class="tab-content active">
        <div class="register-grid">
          <div class="card">
            <h3>Capture Face</h3>
            <div class="video-wrapper small" style="position: relative;">
              <!-- svelte-ignore a11y_media_has_caption -->
              <video bind:this={registerVideoEl} autoplay muted playsinline></video>
            </div>
            <div class="capture-actions" style="margin-top: 10px; display: flex; gap: 10px;">
              {#if !isRegisterCameraActive}
                <button onclick={startRegisterCamera} class="btn btn-ghost">Start Camera</button>
              {:else}
                <button onclick={captureRegisterFace} class="btn btn-primary">Capture</button>
                <button onclick={stopRegisterCamera} class="btn btn-ghost">Stop</button>
              {/if}
            </div>
            {#if capturedRegImgData}
              <div class="capture-preview" style="margin-top: 10px;">
                <img src={capturedRegImgData} alt="Captured" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover; border: 2px solid var(--primary-color);">
              </div>
            {/if}
          </div>
          <div class="card">
            <h3>User Details</h3>
            <form onsubmit={handleAdminRegister} class="form">
              <div class="form-group">
                <label for="reg-form-emp-id">User/Employee ID</label>
                <input bind:value={regFormEmpId} type="text" id="reg-form-emp-id" required placeholder="EMP001">
              </div>
              <div class="form-group">
                <label for="reg-form-name">Full Name</label>
                <input bind:value={regFormName} type="text" id="reg-form-name" required placeholder="John Smith">
              </div>
              <div class="form-group">
                <label for="reg-form-role">System Role</label>
                <select bind:value={regFormRole} id="reg-form-role" class="form-select">
                  <option value="attendee">Attendee</option>
                  <option value="host">Host</option>
                </select>
              </div>
              <button type="submit" class="btn btn-primary btn-full">Register User</button>
            </form>
          </div>
        </div>
      </section>
    {/if}

    <!-- Admin Users Grid -->
    {#if activeTab === 'users'}
      <section id="users" class="tab-content active">
        <div class="card">
          <div class="card-header">
            <h3>Registered Users</h3>
          </div>
          <div class="users-grid" style="margin-top: 15px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px;">
            {#each allUsers as u}
              <div class="user-card" style="padding: 15px; border-radius: 6px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); text-align: center; position: relative;">
                {#if u.image_data}
                  <img src={u.image_data} alt="User Face" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; margin: 0 auto 10px;">
                {:else}
                  <div style="width: 50px; height: 50px; border-radius: 50%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; margin: 0 auto 10px;">👤</div>
                {/if}
                <strong>{u.name}</strong>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">{u.employee_id} ({u.role})</div>
                {#if u.role !== 'admin'}
                  <button onclick={() => handleDeleteUser(u.id)} style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px;">&times;</button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/if}

    <!-- History list logs -->
    {#if activeTab === 'logs'}
      <section id="logs" class="tab-content active">
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h3>Attendance History</h3>
            <button onclick={exportHistoryCSV} class="btn btn-ghost">Export CSV</button>
          </div>
          
          <div class="table-wrapper" style="margin-top: 15px;">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Event Name</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                </tr>
              </thead>
              <tbody>
                {#each logs as log}
                  <tr>
                    <td>{log.date.split('T')[0]}</td>
                    <td>{log.name} ({log.employee_id})</td>
                    <td>{log.event_name || 'Generic'}</td>
                    <td>{new Date(log.check_in).toLocaleTimeString()}</td>
                    <td>{log.check_out ? new Date(log.check_out).toLocaleTimeString() : '--'}</td>
                  </tr>
                {:else}
                  <tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No history found.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    {/if}
  </main>

  <!-- Auth modal -->
  {#if showLoginModal}
    <div class="modal show">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="modal-backdrop" onclick={() => { showLoginModal = false; stopModalCamera(); }}></div>
      <div class="modal-content">
        <button class="modal-close" onclick={() => { showLoginModal = false; stopModalCamera(); }}>&times;</button>
        <div class="modal-tabs">
          <button class="modal-tab" class:active={loginTab === 'login'} onclick={() => { loginTab = 'login'; stopModalCamera(); }}>Login</button>
          <button class="modal-tab" class:active={loginTab === 'register'} onclick={() => { loginTab = 'register'; startModalCamera(); }}>Register</button>
        </div>
        
        {#if loginTab === 'login'}
          <form onsubmit={handleLogin} class="auth-form">
            <div class="form-group">
              <label for="login-username">Username</label>
              <input bind:value={loginUsername} type="text" id="login-username" required placeholder="admin">
            </div>
            <div class="form-group">
              <label for="login-password">Password</label>
              <input bind:value={loginPassword} type="password" id="login-password" required placeholder="••••••">
            </div>
            <button type="submit" class="btn btn-primary btn-full">Login</button>
          </form>
        {/if}

        {#if loginTab === 'register'}
          <form onsubmit={handleRegister} class="auth-form" style="max-height: 480px; overflow-y: auto; padding-right: 5px;">
            <div class="form-group">
              <label for="reg-username">Username</label>
              <input bind:value={regUsername} type="text" id="reg-username" required placeholder="username" minlength="3">
            </div>
            <div class="form-group">
              <label for="reg-password">Password</label>
              <input bind:value={regPassword} type="password" id="reg-password" required placeholder="••••••" minlength="6">
            </div>
            <div class="form-group">
              <label for="reg-confirm">Confirm Password</label>
              <input bind:value={regConfirm} type="password" id="reg-confirm" required placeholder="••••••">
            </div>
            <div class="form-group">
              <label for="reg-emp-id">User ID / Employee ID</label>
              <input bind:value={regEmployeeId} type="text" id="reg-emp-id" required placeholder="EMP123">
            </div>
            <div class="form-group">
              <label for="reg-role">Register As</label>
              <select bind:value={regRole} id="reg-role" class="form-select">
                <option value="attendee">Attendee</option>
                <option value="host">Host</option>
              </select>
            </div>
            
            <div class="form-group" style="margin-top: 15px;">
              <label for="register-modal-video">Scan Face (Required to register)</label>
              <div class="video-wrapper small" style="position: relative; height: 160px; border-radius: 6px; overflow: hidden; background: #000; margin-bottom: 10px;">
                <!-- svelte-ignore a11y_media_has_caption -->
                <video bind:this={modalVideoEl} autoplay muted playsinline style="width:100%; height:100%; object-fit: cover;"></video>
              </div>
              <div style="display: flex; gap: 10px;">
                {#if !isModalCameraActive}
                  <button type="button" onclick={startModalCamera} class="btn btn-ghost">Start Face Scan</button>
                {:else}
                  <button type="button" onclick={captureModalFace} class="btn btn-primary">Capture Face</button>
                  <button type="button" onclick={stopModalCamera} class="btn btn-ghost">Stop</button>
                {/if}
              </div>
              {#if capturedModalImgData}
                <div style="margin-top: 10px;">
                  <img src={capturedModalImgData} alt="Face Scan Preview" style="width: 80px; height: 80px; border-radius: 6px; object-fit: cover; border: 2px solid var(--primary-color);">
                </div>
              {/if}
            </div>
            
            <button type="submit" class="btn btn-primary btn-full" style="margin-top: 15px;">Create Account</button>
          </form>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Loading Overlay -->
  {#if loadingMsg}
    <div id="loading" class="loading">
      <div class="spinner"></div>
      <span>{loadingMsg}</span>
    </div>
  {/if}

  <!-- Toast -->
  {#if toastMsg}
    <div class="toast" class:error={toastType === 'error'}>{toastMsg}</div>
  {/if}
</div>
