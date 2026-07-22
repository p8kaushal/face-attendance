import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';

export async function GET({ params, locals }) {
  if (!locals.user || (locals.user.role !== 'host' && locals.user.role !== 'admin')) {
    return json({ error: 'Unauthorized: Host or Admin access required' }, { status: 401 });
  }

  try {
    const result = await query(
      `SELECT a.id, a.user_id, u.employee_id, u.name, a.check_in, a.check_out, a.date 
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.event_id = $1
       ORDER BY a.check_in DESC`,
      [params.id]
    );
    return json(result.rows);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
