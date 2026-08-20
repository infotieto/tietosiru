import type { APIRoute } from 'astro';
import { clearMemberCookieHeader } from '../../../lib/memberAuth.js';

export const prerender = false;

export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearMemberCookieHeader() },
  });
};

export const GET: APIRoute = async () => {
  return new Response(null, { status: 302, headers: { Location: '/member/kirjaudu', 'Set-Cookie': clearMemberCookieHeader() } });
};
