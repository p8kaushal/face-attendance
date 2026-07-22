importScripts('https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.js');

const CACHE_NAME = 'face-attendance-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/db.js',
  '/js/api.js',
  '/js/face.js',
  '/js/app.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.js',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js'
];

// Initialize Dexie in Service Worker
let db;
function initDB() {
  if (!db) {
    db = new Dexie('FaceAttendanceDB');
    db.version(2).stores({
      users: 'id, employeeId',
      attendance: '++id, userId, date',
      offline_queue: '++id, userId, type, offlineUuid, timestamp'
    });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Direct pass-through for API requests, only cache static assets
  if (event.request.url.includes('/api/') || event.request.url.includes('/auth/')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache the latest copy of the static resource
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache only when network fails (offline mode)
        return caches.match(event.request);
      })
  );
});

// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncOfflineAttendance());
  }
});

async function syncOfflineAttendance() {
  initDB();
  const queue = await db.offline_queue.toArray();
  if (queue.length === 0) return;

  // Fetch API base URL dynamically or fallback to relative/default
  const API_URL = ''; // Relative path because they are on the same domain now!

  for (const record of queue) {
    try {
      const response = await fetch(`${API_URL}/api/attendance/record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: record.userId,
          type: record.type,
          qrToken: record.qrToken,
          eventId: record.eventId,
          latitude: record.latitude,
          longitude: record.longitude,
          offlineUuid: record.offlineUuid,
          timestamp: record.timestamp
        })
      });

      if (response.ok || response.status === 409) {
        // Remove from offline queue if successfully synced or returned conflict (already exists)
        await db.offline_queue.delete(record.id);
      }
    } catch (error) {
      console.error('Failed to sync record:', record, error);
      // Let it remain in the queue for next sync attempt
    }
  }

  // Notify active clients that sync completed
  const clientsList = await self.clients.matchAll();
  for (const client of clientsList) {
    client.postMessage({ type: 'SYNC_COMPLETE' });
  }
}
