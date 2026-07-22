import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';

export async function GET({ locals }) {
  if (!locals.user || (locals.user.role !== 'admin' && locals.user.role !== 'host')) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query(`
      SELECT u.employee_id, u.name, a.date, a.check_in, a.check_out, e.name AS event_name
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN events e ON a.event_id = e.id
      ORDER BY a.date DESC, a.check_in DESC
    `);
    return json(result.rows);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
