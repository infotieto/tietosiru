// Auth guard + security headers (PLAN section 6, section 12.2)
import { defineMiddleware } from 'astro:middleware';
import { verifyMemberSession } from './lib/memberAuth.js';

const MEMBER_PREFIXES = ['/member', '/api/orders', '/api/cart'];
const ADMIN_PREFIXES = ['/admin', '/api/admin'];

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Member guard
  if (MEMBER_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    // Allow login page itself
    if (pathname.startsWith('/member/kirjaudu') || pathname.startsWith('/api/auth')) {
      // fall through
    } else {
      const cookie = context.cookies.get('member_session')?.value;
      const session = await verifyMemberSession(cookie);
      if (!session) {
        // API -> 401, pages -> redirect
        if (pathname.startsWith('/api/')) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return context.redirect('/member/kirjaudu');
      }
      // expose to pages
      (context.locals as Record<string, unknown>).memberEmail = session.email;
    }
  }

  // Admin guard is handled via Supabase Auth in pages; middleware is a second layer
  // (do not redirect here to avoid loops during login)

  const response = await next();

  // Security headers on every response
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!response.headers.has('Permissions-Policy')) {
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }

  return response;
});
