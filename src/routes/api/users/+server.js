import { json } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';
import { extractEmbedding } from '$lib/server/face.js';

// List all users
export async function GET({ locals }) {
  if (!locals.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await query('SELECT id, external_id, employee_id, name, image_data, role, created_at, created_by FROM users ORDER BY created_at DESC');
    return json(result.rows);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

// Create user (Admin only)
export async function POST({ request, locals }) {
  if (!locals.user || locals.user.role !== 'admin') {
    return json({ error: 'Unauthorized: Admin access required' }, { status: 401 });
  }

  try {
    const { employeeId, name, faceDescriptor, planarArray, imageData, role = 'attendee' } = await request.json();
    
    const existing = await query('SELECT id FROM users WHERE employee_id = $1', [employeeId]);
    if (existing.rows.length > 0) {
      return json({ error: 'Employee ID already exists' }, { status: 400 });
    }

    let finalDescriptor = '[]';
    if (planarArray) {
      const embedding = await extractEmbedding(planarArray);
      finalDescriptor = JSON.stringify(embedding);
    } else if (faceDescriptor) {
      finalDescriptor = JSON.stringify(faceDescriptor);
    }

    const result = await query(
      `INSERT INTO users (employee_id, name, face_descriptor, image_data, role, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, employee_id, name, image_data, role, created_at`,
      [employeeId, name, finalDescriptor, imageData || null, role, locals.user.username]
    );
    
    return json(result.rows[0], { status: 201 });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
