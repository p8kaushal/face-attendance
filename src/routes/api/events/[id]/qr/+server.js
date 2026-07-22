import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { query } from '$lib/server/db.js';
import { env } from '$env/dynamic/private';

export async function POST({ params, request, locals }) {
  if (!locals.user || (locals.user.role !== 'host' && locals.user.role !== 'admin')) {
    return json({ error: 'Unauthorized: Host or Admin access required' }, { status: 401 });
  }

  try {
    const { expiresInSeconds = 86400 } = await request.json();
    const eventResult = await query('SELECT * FROM events WHERE id = $1', [params.id]);
    if (eventResult.rows.length === 0) {
      return json({ error: 'Event not found' }, { status: 404 });
    }

    const event = eventResult.rows[0];
    const secret = env.JWT_SECRET || env.SESSION_SECRET || 'secret';
    
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

    return json({ token, expiresInSeconds });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
