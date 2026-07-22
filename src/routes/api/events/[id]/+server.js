import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';

export async function GET({ params, locals }) {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query(
      `SELECT e.*, u.name as host_name 
       FROM events e 
       LEFT JOIN users u ON e.host_id = u.id 
       WHERE e.id = $1`,
      [params.id]
    );
    if (result.rows.length === 0) {
      return json({ error: 'Event not found' }, { status: 404 });
    }
    return json(result.rows[0]);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
