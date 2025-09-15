import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { validateLogin } from '@/db/operations';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const user = await validateLogin(username, password);
    if (!user) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Return minimal user info; in a real app, set a cookie/session here
    return NextResponse.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    console.error('Login error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
