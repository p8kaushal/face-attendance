import express from 'express';
import crypto from 'crypto';
import { query } from '../db/database.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password, role = 'attendee', employeeId, faceDescriptor, imageData, name } = req.body;
    
    if (!username || !password || !employeeId || !faceDescriptor) {
      return res.status(400).json({ error: 'Username, password, employee ID, and face scan are required' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be 3+ chars, password 6+ chars' });
    }

    const existing = await query('SELECT id FROM users WHERE username = $1 OR employee_id = $2', [username, employeeId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username or Employee ID already registered' });
    }

    const hashedPassword = hashPassword(password);
    const result = await query(
      `INSERT INTO users (employee_id, name, face_descriptor, image_data, username, password_hash, role, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [employeeId, name || username, JSON.stringify(faceDescriptor), imageData || null, username, hashedPassword, role, 'self']
    );

    const user = { id: result.rows[0].id, username, role, isAdmin: role === 'admin' };
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(user);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const hashedPassword = hashPassword(password);
    const result = await query(
      'SELECT * FROM users WHERE username = $1 AND password_hash = $2',
      [username, hashedPassword]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const dbUser = result.rows[0];
    const user = { 
      id: dbUser.id, 
      username: dbUser.username, 
      role: dbUser.role || 'attendee', 
      isAdmin: dbUser.role === 'admin', 
      provider: 'local' 
    };
    req.login(user, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(user);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.SESSION_SECRET).digest('hex');
}

export default router;
