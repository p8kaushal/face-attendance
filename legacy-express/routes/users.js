import express from 'express';
import { query } from '../db/database.js';

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT id, external_id, employee_id, name, image_data, role, created_at, created_by FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { employeeId, name, faceDescriptor, imageData, role = 'attendee' } = req.body;
    
    const existing = await query('SELECT id FROM users WHERE employee_id = $1', [employeeId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Employee ID already exists' });
    }

    const result = await query(
      `INSERT INTO users (employee_id, name, face_descriptor, image_data, role, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, employee_id, name, image_data, role, created_at`,
      [employeeId, name, JSON.stringify(faceDescriptor), imageData, role, req.user.username]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM attendance WHERE user_id = $1', [req.params.id]);
    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
