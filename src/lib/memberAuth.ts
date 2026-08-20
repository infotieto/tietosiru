// Member auth — email allow-list with signed httpOnly cookie (PLAN §6.1)
// Forward-compatible: swap verifyMember to OTP later; cookie version invalidates old sessions.
import { getSupabaseServiceRole } from './supabase.js';

const COOKIE_NAME = 'member_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function getSecret(): string {
  const s = import.meta.env.MEMBER_SESSION_SECRET as string | undefined;
  if (!s || s.length < 16) throw new Error('MEMBER_SESSION_SECRET too short — set in .env (32+ chars)');
  return s;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString('base64url');
}

export async function createMemberSession(email: string): Promise<string> {
  const payload = { email: email.toLowerCase().trim(), exp: Date.now() + COOKIE_MAX_AGE * 1000, v: 1 };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = await hmac(data, getSecret());
  return `${data}.${sig}`;
}

export async function verifyMemberSession(value: string | undefined | null): Promise<{ email: string } | null> {
  if (!value || !value.includes('.')) return null;
  const [data, sig] = value.split('.');
  if (!data || !sig) return null;
  const expected = await hmac(data, getSecret());
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as { email: string; exp: number; v: number };
    if (Date.now() > payload.exp) return null;
    if (payload.v !== 1) return null;
    if (!payload.email) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

export function memberCookieHeader(token: string): string {
  const secure = (import.meta.env.PUBLIC_SITE_URL as string | undefined)?.startsWith('https://') ?? true;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function clearMemberCookieHeader(): string {
  const secure = (import.meta.env.PUBLIC_SITE_URL as string | undefined)?.startsWith('https://') ?? true;
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export const MEMBER_COOKIE_NAME = COOKIE_NAME;

/** Server-side allow-list check via service_role (never leaks emails to client). */
export async function isValidMemberEmail(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return false;
  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase.from('customers').select('id').eq('email', normalized).is('deleted_at', null).limit(1).maybeSingle();
  if (error) {
    console.error('isValidMemberEmail error', error);
    return false;
  }
  return !!data;
}
