const DB = {
    dbName: 'FaceAttendanceDB',
    dbVersion: 1,
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('users')) {
                    const usersStore = db.createObjectStore('users', { keyPath: 'id' });
                    usersStore.createIndex('employeeId', 'employeeId', { unique: true });
                }

                if (!db.objectStoreNames.contains('attendance')) {
                    const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
                    attendanceStore.createIndex('userId', 'userId', { unique: false });
                    attendanceStore.createIndex('date', 'date', { unique: false });
                }
            };
        });
    },

    async addUser(user) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['users'], 'readwrite');
            const store = transaction.objectStore('users');
            const request = store.add(user);

            request.onsuccess = () => resolve(user);
            request.onerror = () => reject(request.error);
        });
    },

    async getAllUsers() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['users'], 'readonly');
            const store = transaction.objectStore('users');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getUserById(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['users'], 'readonly');
            const store = transaction.objectStore('users');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async deleteUser(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['users'], 'readwrite');
            const store = transaction.objectStore('users');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async addAttendance(record) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['attendance'], 'readwrite');
            const store = transaction.objectStore('attendance');
            const request = store.add(record);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAttendanceByDate(date) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['attendance'], 'readonly');
            const store = transaction.objectStore('attendance');
            const index = store.index('date');
            const request = index.getAll(date);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAttendanceByUserAndDate(userId, date) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['attendance'], 'readonly');
            const store = transaction.objectStore('attendance');
            const request = store.getAll();

            request.onsuccess = () => {
                const records = request.result.filter(r => r.userId === userId && r.date === date);
                resolve(records);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async getAllAttendance() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['attendance'], 'readonly');
            const store = transaction.objectStore('attendance');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async updateAttendance(id, updates) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['attendance'], 'readwrite');
            const store = transaction.objectStore('attendance');
            const getRequest = store.get(id);

            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (record) {
                    const updatedRecord = { ...record, ...updates };
                    const putRequest = store.put(updatedRecord);
                    putRequest.onsuccess = () => resolve(updatedRecord);
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    reject(new Error('Record not found'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }
};
