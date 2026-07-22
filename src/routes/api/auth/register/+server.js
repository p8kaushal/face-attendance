import { json } from '@sveltejs/kit';
import crypto from 'crypto';
import { query } from '$lib/server/db.js';
import { extractEmbedding } from '$lib/server/face.js';
import { env } from '$env/dynamic/private';

export async function POST({ request, cookies }) {
  try {
    const { username, password, role = 'attendee', employeeId, planarArray, imageData, name } = await request.json();
    
    if (!username || !password || !employeeId || !planarArray) {
      return json({ error: 'Username, password, employee ID, and face scan are required' }, { status: 400 });
    }

    if (username.length < 3 || password.length < 6) {
      return json({ error: 'Username must be 3+ chars, password 6+ chars' }, { status: 400 });
    }

    const existing = await query('SELECT id FROM users WHERE username = $1 OR employee_id = $2', [username, employeeId]);
    if (existing.rows.length > 0) {
      return json({ error: 'Username or Employee ID already registered' }, { status: 400 });
    }

    // Extract ArcFace 512-dimensional embedding vector from the planar array
    const embedding = await extractEmbedding(planarArray);

    const sessionSecret = env.SESSION_SECRET || 'secret';
    const hashedPassword = crypto.createHash('sha256').update(password + sessionSecret).digest('hex');

    const result = await query(
      `INSERT INTO users (employee_id, name, face_descriptor, image_data, username, password_hash, role, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [employeeId, name || username, JSON.stringify(embedding), imageData || null, username, hashedPassword, role, 'self']
    );

    const userId = result.rows[0].id;
    cookies.set('userId', userId.toString(), { path: '/', httpOnly: true, secure: false, maxAge: 60 * 60 * 24 * 7 });

    return json({ id: userId, username, role, isAdmin: role === 'admin' });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
