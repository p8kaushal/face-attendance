import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';

// List events
export async function GET({ locals }) {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let sql = 'SELECT e.*, u.name as host_name FROM events e LEFT JOIN users u ON e.host_id = u.id';
    const params = [];
    if (locals.user.role === 'host') {
      sql += ' WHERE e.host_id = $1';
      params.push(locals.user.id);
    }
    sql += ' ORDER BY e.created_at DESC';
    const result = await query(sql, params);
    return json(result.rows);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

// Create event
export async function POST({ request, locals }) {
  if (!locals.user || (locals.user.role !== 'host' && locals.user.role !== 'admin')) {
    return json({ error: 'Unauthorized: Host or Admin access required' }, { status: 401 });
  }

  try {
    const { name, latitude, longitude, radius_meters, host_image } = await request.json();
    if (!name || latitude === undefined || longitude === undefined) {
      return json({ error: 'Missing required fields: name, latitude, longitude' }, { status: 400 });
    }

    const hostId = locals.user.id || null;

    const result = await query(
      `INSERT INTO events (name, latitude, longitude, radius_meters, host_id, host_image) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, parseFloat(latitude), parseFloat(longitude), radius_meters ? parseFloat(radius_meters) : 100, hostId, host_image || null]
    );
    return json(result.rows[0], { status: 201 });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
