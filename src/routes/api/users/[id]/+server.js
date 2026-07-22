import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';

// Delete user (Admin only)
export async function DELETE({ params, locals }) {
  if (!locals.user || locals.user.role !== 'admin') {
    return json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  try {
    await query('DELETE FROM attendance WHERE user_id = $1', [params.id]);
    await query('DELETE FROM users WHERE id = $1', [params.id]);
    return json({ message: 'User deleted successfully' });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
