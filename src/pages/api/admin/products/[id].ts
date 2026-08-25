import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

async function verifyAdmin(cookies: any) {
  const token = cookies.get('sb-access-token')?.value;
  if (!token) return null;
  const supabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_ANON_KEY);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const serviceSupabase = createClient(import.meta.env.SUPABASE_URL, import.meta.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: adminUser } = await serviceSupabase.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  return adminUser ? serviceSupabase : null;
}

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const supabase = await verifyAdmin(cookies);
  if (!supabase) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const { error } = await supabase.from('products').delete().eq('id', params.id);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
