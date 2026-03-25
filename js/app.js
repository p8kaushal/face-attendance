const App = {
    video: null,
    registerVideo: null,
    overlay: null,
    registerOverlay: null,
    captureCanvas: null,
    users: [],
    attendanceInterval: null,
    lastRecognizedUser: null,
    recognitionCooldown: false,
    capturedDescriptor: null,
    capturedImageData: null,

    async init() {
        await DB.init();
        this.video = document.getElementById('video');
        this.registerVideo = document.getElementById('register-video');
        this.overlay = document.getElementById('overlay');
        this.registerOverlay = document.getElementById('register-overlay');
        this.captureCanvas = document.createElement('canvas');

        this.setupNavigation();
        this.setupRegister();
        this.setupLogs();
        this.setupUsers();

        const modelsLoaded = await FaceAPI.loadModels();
        document.getElementById('model-status').textContent = modelsLoaded
            ? 'AI models loaded successfully'
            : 'Error loading AI models';

        if (modelsLoaded) {
            await this.startAttendanceCamera();
            await this.loadUsers();
            this.renderUsers();
            this.renderTodayStats();
            this.renderLogs();
        }
    },

    setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');

                if (btn.dataset.tab === 'attendance') {
                    this.startAttendanceCamera();
                }
            });
        });
    },

    async startAttendanceCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });

            this.video.srcObject = stream;
            await this.video.play();

            this.overlay.width = this.video.videoWidth;
            this.overlay.height = this.video.videoHeight;

            this.updateStatus('ready', 'Camera ready');
            this.startAttendanceDetection();
        } catch (error) {
            console.error('Camera error:', error);
            this.updateStatus('error', 'Camera access denied');
            this.showToast('Please allow camera access to use attendance', 'error');
        }
    },

    startAttendanceDetection() {
        if (this.attendanceInterval) {
            clearInterval(this.attendanceInterval);
        }

        this.attendanceInterval = setInterval(async () => {
            if (!FaceAPI.modelsLoaded || this.recognitionCooldown) return;

            try {
                const detections = await FaceAPI.detectFace(this.video);
                FaceAPI.clearCanvas(this.overlay);

                const nameEl = document.getElementById('detected-name');
                const statusEl = document.getElementById('detected-status');

                if (detections.length === 0) {
                    nameEl.textContent = 'Waiting for face...';
                    nameEl.classList.add('unknown');
                    statusEl.textContent = 'Position your face in the camera';
                    this.updateStatus('detecting', 'No face detected');
                    return;
                }

                const detection = detections[0];
                FaceAPI.drawFaceBox(this.overlay, detection);

                if (detections.length > 1) {
                    nameEl.textContent = 'Multiple faces';
                    nameEl.classList.add('unknown');
                    statusEl.textContent = 'Please ensure only one face is visible';
                    this.updateStatus('detecting', 'Multiple faces');
                    return;
                }

                const descriptor = detection.descriptor;
                const { user, distance } = FaceAPI.findMatchingUser(descriptor, this.users);

                if (user) {
                    nameEl.textContent = user.name;
                    nameEl.classList.remove('unknown');
                    this.updateStatus('recognized', 'Face recognized');

                    if (this.lastRecognizedUser !== user.id) {
                        this.lastRecognizedUser = user.id;
                        await this.recordAttendance(user);
                    }
                } else {
                    nameEl.textContent = 'Unknown Person';
                    nameEl.classList.add('unknown');
                    statusEl.textContent = 'This face is not registered';
                    this.updateStatus('detecting', 'Unknown face');
                    this.lastRecognizedUser = null;
                }

            } catch (error) {
                console.error('Detection error:', error);
            }
        }, 500);
    },

    async recordAttendance(user) {
        this.recognitionCooldown = true;

        const today = new Date().toISOString().split('T')[0];
        const existingRecords = await DB.getAttendanceByUserAndDate(user.id, today);

        if (existingRecords.length === 0) {
            await DB.addAttendance({
                userId: user.id,
                userName: user.name,
                employeeId: user.employeeId,
                date: today,
                checkIn: new Date().toISOString(),
                checkOut: null
            });
            this.showToast(`${user.name} checked in`, 'success');
        } else {
            const lastRecord = existingRecords[existingRecords.length - 1];
            if (!lastRecord.checkOut) {
                lastRecord.checkOut = new Date().toISOString();
                await DB.updateAttendance(lastRecord.id, { checkOut: lastRecord.checkOut });
                this.showToast(`${user.name} checked out`, 'success');
            } else {
                await DB.addAttendance({
                    userId: user.id,
                    userName: user.name,
                    employeeId: user.employeeId,
                    date: today,
                    checkIn: new Date().toISOString(),
                    checkOut: null
                });
                this.showToast(`${user.name} checked in again`, 'success');
            }
        }

        this.renderTodayStats();
        this.renderLogs();

        setTimeout(() => {
            this.recognitionCooldown = false;
        }, 3000);
    },

    async startRegisterCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 320, height: 240, facingMode: 'user' }
            });

            this.registerVideo.srcObject = stream;
            await this.registerVideo.play();

            this.registerOverlay.width = this.registerVideo.videoWidth;
            this.registerOverlay.height = this.registerVideo.videoHeight;

            this.startRegisterDetection();
        } catch (error) {
            console.error('Camera error:', error);
            this.showToast('Please allow camera access', 'error');
        }
    },

    startRegisterDetection() {
        const detectInterval = setInterval(async () => {
            if (!FaceAPI.modelsLoaded) return;

            try {
                const detections = await FaceAPI.detectFace(this.registerVideo);
                FaceAPI.clearCanvas(this.registerOverlay);
                document.getElementById('capture-btn').disabled = true;

                if (detections.length === 1) {
                    FaceAPI.drawFaceBox(this.registerOverlay, detections[0], '#10b981');
                    document.getElementById('capture-btn').disabled = false;
                }
            } catch (error) {
                console.error('Detection error:', error);
            }
        }, 500);

        this.registerDetectionInterval = detectInterval;
    },

    setupRegister() {
        const captureBtn = document.getElementById('capture-btn');
        const retakeBtn = document.getElementById('retake-btn');
        const form = document.getElementById('register-form');
        const preview = document.getElementById('capture-preview');

        document.querySelector('[data-tab="register"]').addEventListener('click', () => {
            this.startRegisterCamera();
        });

        captureBtn.addEventListener('click', async () => {
            try {
                this.capturedDescriptor = await FaceAPI.captureFaceDescriptor(this.registerVideo);

                this.captureCanvas.width = this.registerVideo.videoWidth;
                this.captureCanvas.height = this.registerVideo.videoHeight;
                const ctx = this.captureCanvas.getContext('2d');
                ctx.drawImage(this.registerVideo, 0, 0);
                this.capturedImageData = this.captureCanvas.toDataURL('image/jpeg');

                document.getElementById('captured-image').src = this.capturedImageData;
                preview.classList.remove('hidden');
                form.classList.remove('hidden');
                captureBtn.classList.add('hidden');
                retakeBtn.classList.remove('hidden');

                if (this.registerVideo.srcObject) {
                    this.registerVideo.srcObject.getTracks().forEach(track => track.stop());
                }
                clearInterval(this.registerDetectionInterval);
                FaceAPI.clearCanvas(this.registerOverlay);

            } catch (error) {
                this.showToast(error.message, 'error');
            }
        });

        retakeBtn.addEventListener('click', () => {
            this.capturedDescriptor = null;
            this.capturedImageData = null;
            preview.classList.add('hidden');
            form.classList.add('hidden');
            captureBtn.classList.remove('hidden');
            retakeBtn.classList.add('hidden');
            document.getElementById('register-form').reset();
            this.startRegisterCamera();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const employeeId = document.getElementById('employee-id').value.trim();
            const name = document.getElementById('employee-name').value.trim();

            const existingUser = this.users.find(u => u.employeeId === employeeId);
            if (existingUser) {
                this.showToast('Employee ID already exists', 'error');
                return;
            }

            const user = {
                id: Date.now().toString(),
                employeeId,
                name,
                descriptor: Array.from(this.capturedDescriptor),
                imageData: this.capturedImageData,
                createdAt: new Date().toISOString()
            };

            await DB.addUser(user);
            this.users.push(user);

            this.showToast(`${name} registered successfully`, 'success');

            this.capturedDescriptor = null;
            this.capturedImageData = null;
            preview.classList.add('hidden');
            form.classList.add('hidden');
            captureBtn.classList.remove('hidden');
            retakeBtn.classList.add('hidden');
            form.reset();

            this.renderUsers();
        });
    },

    async loadUsers() {
        this.users = await DB.getAllUsers();
    },

    renderUsers() {
        const grid = document.getElementById('users-grid');
        const count = document.getElementById('user-count');

        count.textContent = `${this.users.length} users`;

        if (this.users.length === 0) {
            grid.innerHTML = '<p class="empty-state">No users registered yet. Go to Register tab to add users.</p>';
            return;
        }

        grid.innerHTML = this.users.map(user => `
            <div class="user-card" data-id="${user.id}">
                <div class="user-avatar">
                    ${user.imageData 
                        ? `<img src="${user.imageData}" alt="${user.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`
                        : user.name.charAt(0).toUpperCase()
                    }
                </div>
                <h3>${user.name}</h3>
                <p>${user.employeeId}</p>
                <button class="btn btn-danger" onclick="App.deleteUser('${user.id}')">Delete</button>
            </div>
        `).join('');
    },

    async deleteUser(id) {
        if (confirm('Are you sure you want to delete this user?')) {
            await DB.deleteUser(id);
            this.users = this.users.filter(u => u.id !== id);
            this.renderUsers();
            this.showToast('User deleted', 'success');
        }
    },

    renderTodayStats() {
        const grid = document.getElementById('stats-grid');
        const today = new Date().toISOString().split('T')[0];

        DB.getAttendanceByDate(today).then(records => {
            if (records.length === 0) {
                grid.innerHTML = '<p class="empty-state">No attendance today</p>';
                return;
            }

            const latestByUser = {};
            records.forEach(record => {
                if (!latestByUser[record.userId] || 
                    new Date(record.checkIn) > new Date(latestByUser[record.userId].checkIn)) {
                    latestByUser[record.userId] = record;
                }
            });

            grid.innerHTML = Object.values(latestByUser).map(record => {
                const checkInTime = new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const checkOutTime = record.checkOut 
                    ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '---';
                const status = record.checkOut ? 'Checked out' : 'Checked in';

                return `
                    <div class="stat-card ${record.checkOut ? 'checked-out' : 'checked-in'}">
                        <span class="name">${record.userName}</span>
                        <span class="time">
                            ${checkInTime} - ${checkOutTime}
                            <span class="status">${status}</span>
                        </span>
                    </div>
                `;
            }).join('');
        });
    },

    setupLogs() {
        const dateFilter = document.getElementById('log-date-filter');
        const userFilter = document.getElementById('log-user-filter');
        const exportBtn = document.getElementById('export-btn');

        dateFilter.value = new Date().toISOString().split('T')[0];

        dateFilter.addEventListener('change', () => this.renderLogs());
        userFilter.addEventListener('change', () => this.renderLogs());

        exportBtn.addEventListener('click', () => this.exportToCSV());
    },

    async renderLogs() {
        const tbody = document.getElementById('logs-tbody');
        const userFilter = document.getElementById('log-user-filter');
        const dateFilter = document.getElementById('log-date-filter');

        let records = await DB.getAllAttendance();

        if (dateFilter.value) {
            records = records.filter(r => r.date === dateFilter.value);
        }

        if (userFilter.value) {
            records = records.filter(r => r.userId === userFilter.value);
        }

        records.sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No attendance records found.</td></tr>';
            return;
        }

        tbody.innerHTML = records.map(record => {
            const checkInTime = new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const checkOutTime = record.checkOut 
                ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '---';

            let duration = '---';
            if (record.checkIn && record.checkOut) {
                const diff = new Date(record.checkOut) - new Date(record.checkIn);
                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                duration = `${hours}h ${minutes}m`;
            }

            return `
                <tr>
                    <td>${record.date}</td>
                    <td>${record.userName}</td>
                    <td>${checkInTime}</td>
                    <td>${checkOutTime}</td>
                    <td>${duration}</td>
                </tr>
            `;
        }).join('');
    },

    updateUserFilter() {
        const userFilter = document.getElementById('log-user-filter');
        userFilter.innerHTML = '<option value="">All Users</option>' +
            this.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    },

    async exportToCSV() {
        const records = await DB.getAllAttendance();
        
        if (records.length === 0) {
            this.showToast('No data to export', 'error');
            return;
        }

        const headers = ['Date', 'Employee ID', 'Name', 'Check-In', 'Check-Out', 'Duration (minutes)'];
        const rows = records.map(r => {
            const checkIn = new Date(r.checkIn).toLocaleString();
            const checkOut = r.checkOut ? new Date(r.checkOut).toLocaleString() : '';
            let duration = '';
            if (r.checkIn && r.checkOut) {
                duration = Math.round((new Date(r.checkOut) - new Date(r.checkIn)) / 60000).toString();
            }
            return [r.date, r.employeeId, r.userName, checkIn, checkOut, duration];
        });

        const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast('CSV exported successfully', 'success');
    },

    setupUsers() {
        const observer = new MutationObserver(() => {
            this.updateUserFilter();
        });

        const usersGrid = document.getElementById('users-grid');
        observer.observe(usersGrid, { childList: true });

        this.updateUserFilter();
    },

    updateStatus(type, message) {
        const badge = document.getElementById('status-badge');
        badge.className = 'status-badge ' + type;
        badge.textContent = message;
    },

    showToast(message, type = '') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast ' + type;

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
