import { initDB } from '$lib/server/db.js';
import { initFaceModel } from '$lib/server/face.js';

let initialized = false;

export async function handle({ event, resolve }) {
  if (!initialized) {
    try {
      console.log('Initializing PostgreSQL database...');
      await initDB();
      console.log('Initializing ArcFace ONNX model...');
      await initFaceModel();
      initialized = true;
    } catch (err) {
      console.error('Startup initialization failed:', err);
    }
  }

  // Session retrieval from cookie
  const userId = event.cookies.get('userId');
  if (userId) {
    try {
      const { query } = await import('$lib/server/db.js');
      const result = await query('SELECT id, name, username, role FROM users WHERE id = $1', [userId]);
      if (result.rows.length > 0) {
        const u = result.rows[0];
        event.locals.user = {
          id: u.id,
          name: u.name,
          username: u.username,
          role: u.role,
          isAdmin: u.role === 'admin'
        };
      }
    } catch (e) {
      console.error('Session retrieval error:', e);
    }
  }

  const response = await resolve(event);
  return response;
}
