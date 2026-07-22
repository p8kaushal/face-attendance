import { json } from '@sveltejs/kit';
import crypto from 'crypto';
import { query } from '$lib/server/db.js';
import { env } from '$env/dynamic/private';

export async function POST({ request, cookies }) {
  try {
    const { username, password } = await request.json();
    
    if (!username || !password) {
      return json({ error: 'Username and password required' }, { status: 400 });
    }

    const sessionSecret = env.SESSION_SECRET || process.env.SESSION_SECRET || 'secret';
    const hashedPassword = crypto.createHash('sha256').update(password + sessionSecret).digest('hex');

    console.log('DEBUG: Login attempt for username:', username);
    console.log('DEBUG: Using sessionSecret:', sessionSecret);
    console.log('DEBUG: Generated hashedPassword:', hashedPassword);

    const userCheck = await query('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
    if (userCheck.rows.length === 0) {
      console.log('DEBUG: Username not found in DB');
      return json({ error: 'Invalid credentials (User not found)' }, { status: 401 });
    }
    console.log('DEBUG: User found in DB:', userCheck.rows[0]);

    const result = await query(
      'SELECT * FROM users WHERE username = $1 AND password_hash = $2',
      [username, hashedPassword]
    );

    if (result.rows.length === 0) {
      console.log('DEBUG: Password hash mismatch');
      return json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const dbUser = result.rows[0];
    cookies.set('userId', dbUser.id.toString(), { path: '/', httpOnly: true, secure: false, maxAge: 60 * 60 * 24 * 7 });

    return json({ 
      id: dbUser.id, 
      username: dbUser.username, 
      role: dbUser.role || 'attendee', 
      isAdmin: dbUser.role === 'admin'
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
