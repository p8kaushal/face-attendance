import Dexie from 'dexie';

const DB = {
  db: null,

  async init() {
    if (this.db) return this.db;
    this.db = new Dexie('OfflineAttendanceDB');
    this.db.version(1).stores({
      offline_queue: '++id, offlineUuid, timestamp'
    });
    return this.db;
  },

  async addToOfflineQueue(record) {
    await this.init();
    return this.db.offline_queue.add({
      ...record,
      offlineUuid: record.offlineUuid || crypto.randomUUID(),
      timestamp: record.timestamp || new Date().toISOString()
    });
  },

  async getOfflineQueue() {
    await this.init();
    return this.db.offline_queue.toArray();
  },

  async deleteFromOfflineQueue(id) {
    await this.init();
    return this.db.offline_queue.delete(id);
  },

  async clearOfflineQueue() {
    await this.init();
    return this.db.offline_queue.clear();
  }
};

export default DB;
