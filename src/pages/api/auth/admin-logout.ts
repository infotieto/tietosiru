import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin/kirjaudu' },
  });
};

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
