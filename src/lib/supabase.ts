// Supabase helpers — keeps service_role on server only (PLAN §6, §15)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function required(name: string): string {
  const v = import.meta.env[name] as string | undefined;
  if (!v) throw new Error(`Missing env ${name} — see .env.example`);
  return v;
}

let anonClient: SupabaseClient | null = null;

/** Anon client — safe for pages that need public product reads. */
export function getSupabaseAnon(): SupabaseClient {
  if (anonClient) return anonClient;
  anonClient = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
  });
  return anonClient;
}

/** Service-role client — server only. Bypasses RLS. Never import in client islands. */
export function getSupabaseServiceRole(): SupabaseClient {
  // import.meta.env.SUPABASE_SERVICE_ROLE_KEY is only available server-side via Netlify/astro
  const url = import.meta.env.SUPABASE_URL as string | undefined;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (server only)');
  return createClient(url, key, { auth: { persistSession: false } });
}
