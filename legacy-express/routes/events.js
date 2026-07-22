import express from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db/database.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireHostOrAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.role !== 'admin' && req.user.role !== 'host' && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden: Host or Admin access required' });
  }
  next();
}

// Create event (Host & Admin)
router.post('/', requireHostOrAdmin, async (req, res) => {
  try {
    const { name, latitude, longitude, radius_meters, host_image } = req.body;
    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Missing required fields: name, latitude, longitude' });
    }
    
    // Attempt to link to the logged-in user as the host
    const hostId = req.user.id || null;

    const result = await query(
      `INSERT INTO events (name, latitude, longitude, radius_meters, host_id, host_image) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, parseFloat(latitude), parseFloat(longitude), radius_meters ? parseFloat(radius_meters) : 100, hostId, host_image || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List events (Auth required)
router.get('/', requireAuth, async (req, res) => {
  try {
    // If the logged-in user is a Host, they only see their own events. If Admin, they see all events. Attendees see all.
    let sql = 'SELECT * FROM events';
    const params = [];
    if (req.user.role === 'host') {
      sql += ' WHERE host_id = $1';
      params.push(req.user.id);
    }
    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single event details with creator info (Auth required)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT e.*, u.name as host_name 
       FROM events e 
       LEFT JOIN users u ON e.host_id = u.id 
       WHERE e.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get attendance for specific event (Host & Admin only)
router.get('/:id/attendance', requireHostOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT a.id, a.user_id, u.employee_id, u.name, a.check_in, a.check_out, a.date 
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.event_id = $1
       ORDER BY a.check_in DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate time-limited, signed QR code JWT (Host & Admin)
router.post('/:id/qr', requireHostOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { expiresInSeconds = 60 } = req.body;

    const eventResult = await query('SELECT * FROM events WHERE id = $1', [id]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'secret';
    
    const token = jwt.sign(
      {
        eventId: event.id,
        name: event.name,
        latitude: event.latitude,
        longitude: event.longitude,
        radius: event.radius_meters
      },
      secret,
      { expiresIn: parseInt(expiresInSeconds) }
    );

    res.json({ token, expiresInSeconds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
