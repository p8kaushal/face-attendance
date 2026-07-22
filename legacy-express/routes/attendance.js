import express from 'express';
import { query } from '../db/database.js';

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { date, userId } = req.query;
    let sql = `
      SELECT a.id, a.user_id, u.employee_id, u.name, a.check_in, a.check_out, a.date, e.name AS event_name, e.latitude AS event_lat, e.longitude AS event_lon 
      FROM attendance a 
      JOIN users u ON a.user_id = u.id
      LEFT JOIN events e ON a.event_id = e.id
    `;
    const params = [];
    const conditions = [];

    if (date) {
      params.push(date);
      conditions.push(`a.date = $${params.length}`);
    }
    if (userId && userId !== 'undefined') {
      params.push(userId);
      conditions.push(`a.user_id = $${params.length}`);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY a.check_in DESC';


    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

import jwt from 'jsonwebtoken';

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const f1 = lat1 * Math.PI/180;
  const f2 = lat2 * Math.PI/180;
  const df = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(df/2) * Math.sin(df/2) +
            Math.cos(f1) * Math.cos(f2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

router.post('/record', async (req, res) => {
  try {
    const { userId, type, qrToken, eventId: bodyEventId, latitude, longitude, offlineUuid, timestamp } = req.body;
    
    // Check for offline UUID duplicates (collision handling)
    if (offlineUuid) {
      const existing = await query('SELECT id FROM attendance WHERE offline_uuid = $1', [offlineUuid]);
      if (existing.rows.length > 0) {
        return res.json({ success: true, message: 'Record already synced (duplicate ignored)' });
      }
    }

    const checkInTime = timestamp ? new Date(timestamp) : new Date();
    const today = checkInTime.toISOString().split('T')[0];
    let eventId = bodyEventId || null;

    if (qrToken) {
      const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'secret';
      let decoded;
      try {
        decoded = jwt.verify(qrToken, secret, { ignoreExpiration: true });
      } catch (err) {
        return res.status(400).json({ error: 'Invalid QR signature' });
      }

      const tokenExp = decoded.exp * 1000;
      const tokenIat = decoded.iat * 1000;
      const tolerance = 60000; // 60 seconds clock drift tolerance
      if (checkInTime.getTime() > tokenExp + tolerance || checkInTime.getTime() < tokenIat - tolerance) {
        return res.status(400).json({ error: 'QR Code expired or invalid for this time' });
      }

      eventId = decoded.eventId;
    }

    // Proximity check (if user coordinates and event coordinates are available)
    if (eventId && latitude !== undefined && longitude !== undefined) {
      const eventResult = await query('SELECT latitude, longitude, radius_meters FROM events WHERE id = $1', [eventId]);
      if (eventResult.rows.length > 0) {
        const event = eventResult.rows[0];
        const dist = getDistance(latitude, longitude, event.latitude, event.longitude);
        if (dist > event.radius_meters) {
          return res.status(400).json({ error: `Out of range. Distance: ${Math.round(dist)}m, Max: ${event.radius_meters}m` });
        }
      }
    }

    // Automatic type determination
    let finalType = type;
    const lastRecord = await query(
      'SELECT id FROM attendance WHERE user_id = $1 AND date = $2 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
      [userId, today]
    );

    if (!finalType) {
      finalType = lastRecord.rows.length > 0 ? 'out' : 'in';
    }

    if (finalType === 'in') {
      await query(
        'INSERT INTO attendance (user_id, check_in, date, event_id, latitude, longitude, offline_uuid) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, checkInTime, today, eventId, latitude, longitude, offlineUuid || null]
      );
    } else {
      if (lastRecord.rows.length > 0) {
        await query(
          'UPDATE attendance SET check_out = $1, latitude = $2, longitude = $3, offline_uuid = COALESCE($4, offline_uuid) WHERE id = $5',
          [checkInTime, latitude, longitude, offlineUuid || null, lastRecord.rows[0].id]
        );
      } else {
        await query(
          'INSERT INTO attendance (user_id, check_in, check_out, date, event_id, latitude, longitude, offline_uuid) VALUES ($1, $2, $2, $3, $4, $5, $6, $7)',
          [userId, checkInTime, today, eventId, latitude, longitude, offlineUuid || null]
        );
      }
    }
    res.json({ success: true, type: finalType });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, employee_id, name, face_descriptor FROM users ORDER BY name`
    );
    res.json(result.rows.map(u => ({ ...u, faceDescriptor: JSON.parse(u.face_descriptor) })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/export', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT u.employee_id, u.name, a.date, a.check_in, a.check_out, e.name AS event_name
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN events e ON a.event_id = e.id
      ORDER BY a.date DESC, a.check_in DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
