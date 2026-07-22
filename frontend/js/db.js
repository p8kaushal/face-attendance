const DB = {
  db: null,

  async init() {
    this.db = new Dexie('FaceAttendanceDB');
    this.db.version(2).stores({
      users: 'id, employeeId',
      attendance: '++id, userId, date',
      offline_queue: '++id, userId, type, offlineUuid, timestamp'
    });
    return this.db;
  },

  async addUser(user) {
    await this.db.users.put(user);
    return user;
  },

  async getAllUsers() {
    return this.db.users.toArray();
  },

  async getUserById(id) {
    return this.db.users.get(id);
  },

  async deleteUser(id) {
    return this.db.users.delete(id);
  },

  async addAttendance(record) {
    return this.db.attendance.add(record);
  },

  async getAttendanceByDate(date) {
    return this.db.attendance.where('date').equals(date).toArray();
  },

  async getAttendanceByUserAndDate(userId, date) {
    return this.db.attendance.where({ userId, date }).toArray();
  },

  async getAllAttendance() {
    return this.db.attendance.toArray();
  },

  async updateAttendance(id, updates) {
    const record = await this.db.attendance.get(id);
    if (!record) throw new Error('Record not found');
    const updated = { ...record, ...updates };
    await this.db.attendance.put(updated);
    return updated;
  },

  // Offline queue operations
  async addToOfflineQueue(record) {
    return this.db.offline_queue.add({
      ...record,
      offlineUuid: record.offlineUuid || crypto.randomUUID(),
      timestamp: record.timestamp || new Date().toISOString()
    });
  },

  async getOfflineQueue() {
    return this.db.offline_queue.toArray();
  },

  async deleteFromOfflineQueue(id) {
    return this.db.offline_queue.delete(id);
  },

  async clearOfflineQueue() {
    return this.db.offline_queue.clear();
  }
};
