import { json } from '@sveltejs/kit';

export async function POST({ cookies }) {
  cookies.delete('userId', { path: '/' });
  return json({ message: 'Logged out successfully' });
}
