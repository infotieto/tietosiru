import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  let email = '';
  let password = '';

  try {
    const body = await request.json() as { email?: string; password?: string };
    email = body.email?.trim() || '';
    password = body.password || '';
  } catch {
    return new Response(JSON.stringify({ error: 'Virheellinen pyyntö' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Sähköposti ja salasana vaaditaan' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = import.meta.env.SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return new Response(JSON.stringify({ error: 'Virheellinen sähköposti tai salasana' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if user is admin
  const serviceSupabase = createClient(
    import.meta.env.SUPABASE_URL,
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: adminUser } = await serviceSupabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!adminUser) {
    return new Response(JSON.stringify({ error: 'Ei admin-oikeuksia' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set session cookies
  cookies.set('sb-access-token', data.session.access_token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  cookies.set('sb-refresh-token', data.session.refresh_token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
