import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';

export async function GET({ url, locals }) {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const date = url.searchParams.get('date');
    const userId = url.searchParams.get('userId');

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
    
    // If the logged-in user is an attendee, they should only see their own history!
    if (locals.user.role === 'attendee') {
      params.push(locals.user.id);
      conditions.push(`a.user_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY a.check_in DESC';

    const result = await query(sql, params);
    return json(result.rows);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
