// POST /api/auth/member-login  { email } -> sets httpOnly cookie if allow-listed (PLAN section 6.1)
import type { APIRoute } from 'astro';
import { isValidMemberEmail, createMemberSession, memberCookieHeader } from '../../../lib/memberAuth.js';

export const prerender = false;

const GENERIC_MSG = 'Jos sähköposti löytyy, olet kirjautunut sisään.';
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
// In-memory fallback rate limit (Netlify Functions are ephemeral; sufficient for <100 users).
// Netlify built-in rate limiting via netlify.toml is the primary limit for static assets.
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  if (b.count >= MAX_PER_WINDOW) return true;
  b.count += 1;
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-nf-client-connection-ip')
    || 'unknown';

  if (rateLimited(ip)) {
    await new Promise((r) => setTimeout(r, 300));
    return new Response(JSON.stringify({ message: GENERIC_MSG, error: 'Too many attempts' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  let email = '';
  try {
    const body = await request.json() as { email?: string };
    email = (body?.email ?? '').trim();
  } catch {
    await new Promise((r) => setTimeout(r, 300));
    return new Response(JSON.stringify({ message: GENERIC_MSG }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (!email || !email.includes('@')) {
    await new Promise((r) => setTimeout(r, 300));
    return new Response(JSON.stringify({ message: GENERIC_MSG }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Constant-time-ish: always delay ~300ms
  const start = Date.now();
  const valid = await isValidMemberEmail(email).catch(() => false);
  const elapsed = Date.now() - start;
  if (elapsed < 300) await new Promise((r) => setTimeout(r, 300 - elapsed));

  if (!valid) {
    return new Response(JSON.stringify({ message: GENERIC_MSG }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const token = await createMemberSession(email);
  return new Response(JSON.stringify({ message: GENERIC_MSG, ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': memberCookieHeader(token),
    },
  });
};
