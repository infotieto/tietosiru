# Tietosiru Store — Project Plan

> **Status:** Planning complete. Implementation not started.
> **Source:** Decisions distilled from planning discussion 2026-08-19.
> **Current codebase:** Fork of `themesberg/flowbite-astro-admin-dashboard` on `astro@2.0.4` / `tailwind@3` / static output. All decisions below assume upgrade first.

---

## 1. Goals & Scope

### 1.1 Three zones

| Zone | Route | Access | Rendering | Language |
|------|-------|--------|-----------|----------|
| **Public** | `/`, `/[lang]/*` | Everyone | Static (`prerender = true`) | Finnish (default, no prefix), English, Swedish |
| **Member (Store)** | `/member/*`, `/api/member/*` | Email allow-list (Supabase) | SSR (`prerender = false`) + middleware guard | Finnish only |
| **Admin** | `/admin/*`, `/api/admin/*` | Supabase Auth (email+password) | SSR + RLS | Finnish only |

Public = company presentation only. No products visible without login. Member = browse products → cart → order → invoice PDF to login email. No payments, no member order management. Admin = CRUD customers (valid emails), products, orders + generate `hyvityslasku`.

### 1.2 Non-goals (MVP)

- No payment provider, no Stripe.
- No Verkkolasku / Finvoice — PDF only (`pdf-lib`). Forward-compatible column kept if needed later.
- No newsletter/marketing.
- No customer self-service order history.

### 1.3 Stack (free-tier target)

```
Astro 7.x + @astrojs/netlify + Tailwind v4 (@tailwindcss/vite)
  ├─ Netlify (hosting + Functions/SSR + built-in rate limiting)
  ├─ Supabase (Postgres + Auth for admin + Storage for PDFs + RLS + pg_cron)
  ├─ Resend (transactional email, 3000/mo free)
  └─ pdf-lib (server-side PDF generation, no extra service)
```

Only paid cost = domain (~12 €/yr). All else fits free tiers.

---

## 2. Architecture

```mermaid
graph TD
  Public[Public /[lang]/* - Static] --> Astro
  Member[Member /member/* - SSR Cookie Auth] --> Astro
  Admin[Admin /admin/* - SSR Supabase Auth] --> Astro
  Astro -- /api/* Netlify Functions --> Supabase[(Supabase: Postgres + Auth + Storage)]
  Astro -- /api/orders/create --> Resend[Resend API]
  Astro -- Netlify Adapter --> Netlify[Netlify]
  Supabase -- RLS --> Tables[(customers, products, orders, order_items, invoice_sequences, credit_note_sequences, order_cancel_logs)]
```

**Rendering mode after upgrade:** `output: 'static'` is now the hybrid default in Astro 5+. No `output: 'hybrid'` key. Pages default to static; opt out per-route with `export const prerender = false`.

---

## 3. Repository Structure (target)

```
/
├─ PLAN.md
├─ astro.config.mjs              # Astro 7 + @astrojs/netlify + @tailwindcss/vite + i18n
├─ netlify.toml                  # headers, redirects, rate-limit
├─ public/
│  ├─ _headers                   # fallback security headers
│  ├─ robots.txt                 # Disallow /member /admin /api
│  └─ favicon.*
├─ supabase/
│  └─ migrations/
│     └─ 001_core.sql            # tables, RLS, invoice sequences, cron
├─ .github/workflows/
│  └─ keep-alive.yml             # ping Supabase every 3d
├─ src/
│  ├─ middleware.ts              # auth guard + security headers
│  ├─ env.d.ts -> .astro/types.d.ts (delete old)
│  ├─ i18n/
│  │  ├─ fi.json                 # UI strings (nav, buttons, labels)
│  │  ├─ en.json
│  │  ├─ sv.json
│  │  └─ index.ts                # getTranslation(), getLanguages()
│  ├─ content/
│  │  └─ public/
│  │     ├─ fi/etusivu.md        # long-form page content per locale
│  │     ├─ en/home.md
│  │     └─ sv/startsida.md
│  ├─ content.config.ts          # defineCollection with loader: glob()
│  ├─ layouts/
│  │  ├─ PublicLayout.astro
│  │  ├─ MemberLayout.astro      # includes CartDrawer
│  │  └─ AdminLayout.astro       # isolates Flowbite styles (.admin-theme)
│  ├─ components/
│  │  ├─ public/  (Hero, Services, About, CTA...)
│  │  ├─ member/  (CartDrawer.tsx, CartItemRow.tsx, ProductCard.astro)
│  │  └─ admin/   (reuse Flowbite dashboard components)
│  ├─ stores/
│  │  └─ cart.ts                 # nanostores + persistent localStorage + 7d eviction
│  ├─ lib/
│  │  ├─ supabase.ts             # createClient (anon) + service_role helper (server only)
│  │  ├─ memberAuth.ts           # verifyMember, createMemberSession, verifyMemberSession
│  │  ├─ invoice.ts              # generateInvoicePdf, generateCreditNotePdf (pdf-lib)
│  │  └─ email.ts               # Resend wrapper
│  └─ pages/
│     ├─ index.astro             # redirect to /fi or [lang] logic
│     ├─ [lang]/
│     │  ├─ index.astro          # public home
│     │  ├─ palvelut.astro       # etc. - all prerendered
│     │  └─ tietosuojaseloste.astro
│     ├─ member/
│     │  ├─ kirjaudu.astro       # login form -> POST /api/auth/member-login
│     │  ├─ tuotteet/
│     │  │  ├─ index.astro       # list
│     │  │  └─ [id].astro
│     │  ├─ ostoskori.astro      # full cart page (optional)
│     │  └─ kassa.astro          # checkout page, prerender=false
│     ├─ admin/
│     │  ├─ kirjaudu.astro       # Supabase Auth login
│     │  ├─ index.astro          # dashboard
│     │  ├─ asiakkaat/...
│     │  ├─ tuotteet/...
│     │  └─ tilaukset/[id].astro # includes "Luo hyvityslasku" button
│     └─ api/
│        ├─ auth/
│        │  ├─ member-login.ts   # POST
│        │  └─ member-logout.ts
│        ├─ orders/
│        │  ├─ create.ts         # POST, creates order + invoice PDF + sends Resend
│        │  └─ cancel.ts         # GET ?token=uuid, customer self-service
│        └─ admin/orders/
│           └─ generate-credit-note.ts
└─ src/styles/
   ├─ global.css                 # tailwind base
   └─ admin.css                  # scoped to .admin-theme
```

---

## 4. Decisions Log

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | Rate limiting | Netlify built-in via `netlify.toml` headers on `/api/auth/*`, no Upstash/Redis | Zero extra accounts, sufficient for <100 customers |
| 2 | Cart storage | `localStorage` (not `sessionStorage`) | Survives tab close / restart, shared across tabs |
| 3 | Cart eviction | 7 days (`updatedAt` check on load) | Balance UX vs stale data |
| 4 | Cart impl | Custom ~120 LOC with `nanostores` + `@nanostores/persistent` | No hosted cart (Snipcart etc. assume Stripe) |
| 5 | Invoice | `pdf-lib` only, no XML/operator | Keeps free, Verkkolasku would need Maventa/Apix (€/invoice) |
| 6 | Cron ping | GitHub Action every 3 days `GET /rest/v1/products?select=id&limit=1` | Prevents Supabase free pause (7d inactivity) |
| 7 | Astro version | Upgrade directly to **Astro 7.2.x** (latest stable) before any feature work | `npx @astrojs/upgrade` + manual fixes; see §7 |
| 8 | GDPR basis | No consent storage needed (legal basis: `sopimus`). Only `Tietosuojaseloste` page | No marketing/newsletter |
| 9 | Retention | Delete/soft-delete customers after **6 years** of no orders (aligns with `Kirjanpitolaki` 6y for invoices) | Keep `orders` 6y, delete customers via `pg_cron` yearly on Jan 1 |
| 10 | Public content | Astro components for layout + **mixed** JSON (UI strings) + Markdown (long-form via Content Collections) | JSON for buttons/labels, Markdown for editable page bodies |
| 11 | Cancel link | Signed `UUID v4` token in Resend email, single-use, 7-day expiry, rate-limited, logged, auto-generates `hyvityslasku` | Sufficient for low-risk B2B; see §9 |
| 12 | Invoice numbers | Per-year sequence table (`invoice_sequences` / `credit_note_sequences`) + trigger | Auto-resets yearly, gapless, thread-safe |
| 13 | Tailwind | Upgrade to **v4** via `@tailwindcss/vite`, use everywhere; isolate admin via `.admin-theme` scope or prefix | Flowbite template stays scoped, public/member share global |
| 14 | i18n scope | Only public side translated; member/admin always Finnish | Simplifies middleware & routing |
| 15 | Indexing | `noindex,nofollow` on member/admin + `robots.txt` Disallow + 401/302 guard | Products never indexed |

---

## 5. Database (Supabase)

### 5.1 Core tables (see `supabase/migrations/001_core.sql`)

```sql
-- customers: allow-list for member login + billing data
customers (
  id uuid pk default gen_random_uuid(),
  email text unique not null,
  company text,
  ytunnus text,
  created_at timestamptz default now(),
  deleted_at timestamptz            -- soft-delete for 6y retention
)

-- products: managed in admin, visible only after member login
products (
  id uuid pk,
  sku text unique,
  name text not null,               -- Finnish only per decision (add _fi/_en/_sv if later needed)
  description text,
  price_cents int not null,         -- integer cents + vat separately
  vat_percent int default 24,       -- e.g. 24
  stock int,
  active bool default true,
  created_at timestamptz
)

-- orders
orders (
  id uuid pk,
  customer_id uuid fk customers.id,
  status text check (status in ('tilattu','laskutettu','maksettu','hyvitetty')) default 'tilattu',
  total_cents int not null,
  invoice_number text unique,       -- generated by trigger: 2026-00001
  invoice_pdf_url text,             -- Supabase Storage path
  credit_note_number text unique,   -- HYV-2026-00001
  credit_note_url text,
  cancel_token uuid unique,         -- for self-service cancel link
  cancel_token_expires_at timestamptz,
  cancelled_at timestamptz,
  cancel_method text,               -- 'customer_self_service' | 'admin'
  credited_by uuid,                 -- admin user id if manual
  created_at timestamptz
)

order_items (
  id uuid pk,
  order_id uuid fk orders.id,
  product_id uuid fk products.id,
  qty int not null,
  price_cents int not null,         -- snapshot at order time
  vat_percent int not null
)

-- admin users linked to auth.users
admin_users (
  user_id uuid pk fk auth.users.id,
  role text default 'admin',
  created_at timestamptz
)

order_cancel_logs (
  id uuid pk default gen_random_uuid(),
  token text not null,
  ip text,
  user_agent text,
  attempted_at timestamptz default now()
)
index on order_cancel_logs(token)

-- Storage bucket
storage bucket: invoices (private, 1GB free)
```

### 5.2 RLS (Row Level Security)

- Enable RLS on all tables.
- `customers`: no anon read. Only `service_role` (used in `/api/auth/member-login` server function) can `SELECT WHERE email = $1`. Admin role can CRUD via Supabase Auth + policy `auth.uid() IN (SELECT user_id FROM admin_users)`.
- `products`: `SELECT WHERE active = true` allowed for `authenticated` + `anon` is **blocked** by middleware — but RLS allows read for any JWT; member cookie is separate so allow `anon` read or `service_role` read in API. Simpler: allow `anon` SELECT for products, guard route with middleware so public never hits page.
- `orders` / `order_items`: only `service_role` and admin role. Customer never reads orders via DB (stateless flow).
- `admin_users`: only admin can read.

### 5.3 Invoice numbering — per-year robust method (chosen)

```sql
-- 1. Tracking tables
CREATE TABLE invoice_sequences (year INT PRIMARY KEY, next_number INT DEFAULT 1);
CREATE TABLE credit_note_sequences (year INT PRIMARY KEY, next_number INT DEFAULT 1);

-- 2. Generator functions
CREATE OR REPLACE FUNCTION generate_invoice_number() RETURNS TEXT AS $$
DECLARE y INT := EXTRACT(YEAR FROM NOW()); n INT;
BEGIN
  INSERT INTO invoice_sequences (year, next_number) VALUES (y, 2)
  ON CONFLICT (year) DO UPDATE SET next_number = invoice_sequences.next_number + 1
  RETURNING next_number - 1 INTO n;
  RETURN y || '-' || LPAD(n::TEXT, 5, '0'); -- 2026-00001
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_credit_note_number() RETURNS TEXT AS $$
DECLARE y INT := EXTRACT(YEAR FROM NOW()); n INT;
BEGIN
  INSERT INTO credit_note_sequences (year, next_number) VALUES (y, 2)
  ON CONFLICT (year) DO UPDATE SET next_number = credit_note_sequences.next_number + 1
  RETURNING next_number - 1 INTO n;
  RETURN 'HYV-' || y || '-' || LPAD(n::TEXT, 5, '0');
END; $$ LANGUAGE plpgsql;

-- 3. Auto columns
ALTER TABLE orders ADD COLUMN invoice_number TEXT UNIQUE;
ALTER TABLE orders ADD COLUMN credit_note_number TEXT UNIQUE;

CREATE OR REPLACE FUNCTION set_invoice_number() RETURNS TRIGGER AS $$
BEGIN NEW.invoice_number := generate_invoice_number(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_invoice_number_trigger BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_invoice_number();

CREATE OR REPLACE FUNCTION set_credit_note_number() RETURNS TRIGGER AS $$
BEGIN NEW.credit_note_number := generate_credit_note_number(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_credit_note_number_trigger
  BEFORE UPDATE OF status ON orders FOR EACH ROW
  WHEN (NEW.status = 'hyvitetty' AND OLD.status != 'hyvitetty')
  EXECUTE FUNCTION set_credit_note_number();
```

Usage: `INSERT INTO orders (...)` trigger fills `invoice_number` automatically; `UPDATE orders SET status='hyvitetty'` fills `credit_note_number`.

### 5.4 Retention automation (6 years)

```sql
CREATE OR REPLACE FUNCTION delete_old_customer_data() RETURNS VOID AS $$
BEGIN
  -- soft-delete: keeps orders FK intact
  UPDATE customers SET deleted_at = NOW()
  WHERE deleted_at IS NULL
    AND created_at < NOW() - INTERVAL '6 years'
    AND id NOT IN (SELECT DISTINCT customer_id FROM orders WHERE created_at > NOW() - INTERVAL '6 years');
END; $$ LANGUAGE plpgsql;

-- Enable pg_cron extension in Supabase Dashboard > Database > Extensions
-- Then schedule yearly:
SELECT cron.schedule('delete-old-customer-data', '0 3 1 1 *', 'SELECT delete_old_customer_data()');
-- Yearly purge of accounting data after statutory 6y (optional, same retention as customers):
-- SELECT cron.schedule('delete-old-orders', '0 3 2 1 *', $$DELETE FROM orders WHERE created_at < NOW() - INTERVAL '6 years'$$);
```

Document in `Tietosuojaseloste`: "Säilytämme asiakastietoja 6 vuotta viimeisestä tilauksesta, minkä jälkeen tiedot poistetaan automaattisesti. Kirjanpitolain mukaiset laskut säilytetään 6 vuotta."

---

## 6. Auth

### 6.1 Member (email allow-list, no password)

**Forward-compatible abstraction:**

```ts
// src/lib/memberAuth.ts
export async function verifyMember(email: string): Promise<boolean> { /* service_role SELECT */ }
export function createMemberSession(email: string): string { /* signed JWT {email, exp, v:1} */ }
export function verifyMemberSession(cookie: string): {email:string}|null { /* verify HMAC */ }
```

**Flow:**
1. `POST /api/auth/member-login` body `{email}` → server `SELECT 1 FROM customers WHERE email = $1 AND deleted_at IS NULL` via `service_role` key (never exposed to client).
2. Constant-time response + generic message: "Jos sähköposti löytyy, olet kirjautunut sisään." + 300ms delay.
3. On success: `Set-Cookie: member_session=<signed JWT>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30d).
4. On failure: `401` with same generic message.
5. Rate limit via `netlify.toml` + in-memory fallback (5 req/min/IP).
6. OTP upgrade path later: swap `verifyMember` to generate `hashed OTP` (5min TTL) + Resend, verify code, same cookie creation; invalidate old cookies via `v:2`.

**Middleware (`src/middleware.ts`):**
```ts
export function onRequest({ request, url }, next) {
  if (url.pathname.startsWith('/member') || url.pathname.startsWith('/api/orders')) {
    const cookie = getCookie(request, 'member_session')
    if (!verifyMemberSession(cookie)) return redirect('/member/kirjaudu')
  }
  if (url.pathname.startsWith('/admin')) {
    // verify Supabase Auth session via supabase.auth.getUser()
  }
  // add security headers to every response
  const res = next()
  res.headers.set('X-Frame-Options','DENY')
  res.headers.set('X-Content-Type-Options','nosniff')
  res.headers.set('Referrer-Policy','strict-origin-when-cross-origin')
  return res
}
```

No valid-email list ever reaches browser DevTools.

### 6.2 Admin (proper)

- Supabase Auth `email + password` (or magic link) + `admin_users` table.
- RLS policies check `auth.uid() IN (SELECT user_id FROM admin_users)`.
- All `/admin/*` pages `prerender = false` + middleware `supabase.auth.getUser()` check.

---

## 7. Astro Upgrade — 2.0.4 → 7.2.x

Latest stable checked 2026-08-18 = `7.2.3`. Requires `Node >=20.3`.

**Breaking changes that affect this repo:**

| Area | Before | After | Fix |
|------|--------|-------|-----|
| `astro.config.mjs` | `output: 'server'` / commented `hybrid` | `output: 'static'` is now hybrid default; `'server'` = all SSR | Set `output: 'static'` or omit; per-page `export const prerender = false` |
| Adapter | none | `@astrojs/netlify` | `npm i @astrojs/netlify` + `adapter: netlify()` |
| Tailwind | `@astrojs/tailwind@3` | `@tailwindcss/vite` + `tailwindcss@4` | `npm uninstall @astrojs/tailwind` → `npm i -D tailwindcss@4 @tailwindcss/vite` → `vite: { plugins: [tailwindcss()] }` |
| `src/env.d.ts` | generated | now `.astro/types.d.ts` | delete `src/env.d.ts`, update `tsconfig.json` `include` |
| Content | `src/content/config.ts` | `src/content.config.ts` + `loader: glob(...)` | move file, add `loader`, `slug`→`id`, `entry.render()`→`render(entry)` |
| `Astro.glob()` | used maybe | removed | `import.meta.glob()` |
| ViewTransitions | `<ViewTransitions/>` | `<ClientRouter/>` | find/replace |
| Image service | Squoosh option | removed | use Sharp (default) |

**Steps:**
```bash
npx @astrojs/upgrade          # runs codemods for Astro + integrations
# then manually fix tailwind v4, adapter, env.d.ts, rebuild
npm run build                 # verify, then visual check of Flowbite admin
```
Do this as **step 0** before any Supabase work. Expect 1–2 days to green build.

---

## 8. i18n — Public Only

**Config:**
```js
// astro.config.mjs
export default defineConfig({
  i18n: { defaultLocale: 'fi', locales: ['fi','en','sv'], routing: { prefixDefaultLocale: false } },
  // fi = no prefix (example.com/), en/sv = /en/, /sv/
})
```

- Member/Admin routes excluded from locale logic (no `[lang]` prefix).
- `hreflang` tags only for public pages.
- Helper `Astro.currentLocale` + `getRelativeLocaleUrl()`.

**Content split (confirmed):**
- JSON for UI strings (`src/i18n/*.json`) rendered via `set:html` where rich text needed; contains `<a>`, `<strong>` as HTML strings.
- Markdown for long-form pages (`src/content/public/<lang>/*.md`) via Content Collections `loader: glob({ pattern: "**/*.md", base: "./src/content/public" })`.
- Layout in Astro components (`Hero.astro`, `Services.astro`…) — Markdown alone too rigid for visually pleasing sections.

Example:
```astro
---
import { getTranslation } from '../../i18n'
import { getCollection } from 'astro:content'
import { render } from 'astro:content'
const t = getTranslation(Astro.currentLocale)
const page = (await getCollection('public')).find(p => p.id === `${Astro.currentLocale}/palvelut`)
const { Content } = await render(page)
---
<h1>{t.services.title}</h1>
<Content />
<div set:html={t.hero.description} />
```

---

## 9. Cart & Checkout

### 9.1 Cart

```ts
// src/stores/cart.ts
import { persistentAtom } from '@nanostores/persistent'
export type CartItem = { id: string, name: string, price_cents: number, vat_percent: number, qty: number }
type CartState = { items: CartItem[]; updatedAt: number }
export const cartState = persistentAtom<CartState>('cart', { items: [], updatedAt: Date.now() }, {
  encode: JSON.stringify, decode: JSON.parse
})
// Eviction: 7 days since last update
if (Date.now() - cartState.get().updatedAt > 7*24*60*60*1000) {
  cartState.set({ items: [], updatedAt: Date.now() })
}
// On every mutation: cartState.set({ items: newItems, updatedAt: Date.now() })

// In MemberLayout.astro: <CartDrawer client:idle /> reads cartState, shows badge
```

Prices stored as **integer cents** + `vat_percent` separately; display via `Intl.NumberFormat('fi-FI',{style:'currency',currency:'EUR'})`.

### 9.2 Checkout

- **Cart as component** in `MemberLayout` (persistent header icon) + **Checkout as page** `src/pages/member/kassa.astro` (`prerender=false`, auth-guarded).
- Checkout form: email (from session, readonly), optional order note, submit → `POST /api/orders/create` with `cart` JSON.
- Server validates session cookie, creates `orders` + `order_items` transactionally, generates `invoice_number` via trigger, generates PDF via `pdf-lib`, uploads to Storage `invoices/<invoice_number>.pdf`, sends email via Resend with PDF attachment + cancel link.

### 9.3 Orders API sketch

```ts
// src/pages/api/orders/create.ts
export const prerender = false
export async function POST({ request, cookies }) {
  const session = verifyMemberSession(cookies.get('member_session')?.value)
  if (!session) return new Response('Unauthorized',{status:401})
  const { items } = await request.json() // validate
  const customer = await supabaseService.from('customers').select('id,email').eq('email', session.email).single()
  const total = items.reduce((s,i)=> s + i.price_cents * i.qty, 0)
  const cancel_token = crypto.randomUUID()
  const { data: order } = await supabaseService.from('orders').insert({
    customer_id: customer.id, total_cents: total, status:'tilattu',
    cancel_token, cancel_token_expires_at: new Date(Date.now()+7*24*60*60*1000).toISOString()
  }).select('id,invoice_number').single()
  // insert order_items ...

  const pdfBytes = await generateInvoicePdf({ order, items, customer })
  await supabaseService.storage.from('invoices').upload(`${order.invoice_number}.pdf`, pdfBytes)
  await sendInvoiceEmail({ to: customer.email, invoice_number: order.invoice_number, pdfBytes, cancel_token })
  return Response.json({ ok:true, invoice_number: order.invoice_number })
}
```

---

## 10. Invoices & Credit Notes

### 10.1 PDF generation (`pdf-lib`)

- Server-side in Netlify Function.
- Template: header (Tietosiru Oy, Y-tunnus, address), invoice number, date, customer email/company, line items, totals, VAT breakdown, `cancelUrl`.
- Attach to Resend: `attachments: [{ filename: 'lasku-2026-00001.pdf', content: Buffer.from(pdfBytes) }]`.
- Also upload to Supabase Storage for admin download.

### 10.2 Credit note (hyvityslasku)

**Customer self-service:** Resend email contains `https://<site>/api/orders/cancel?token=<uuid>`.

**Endpoint `GET /api/orders/cancel?token=...`:**

Security added per decision:
1. Token = `UUID v4` (unguessable)
2. Single-use: check `status !== 'hyvitetty'`
3. Expiry: `cancel_token_expires_at` (7 days)
4. Rate-limited (Netlify)
5. Logging: insert into `order_cancel_logs` (IP, UA, timestamp)
6. HTTPS enforced (Netlify)
7. Plus: generic error messages, no enumeration

Flow:
```
validate token + expiry → check not already hyvitetty → generate credit note PDF (negative amounts, header HYVITYSLASKU, ref original invoice_number) → update orders {status:'hyvitetty', cancelled_at, cancel_method:'customer_self_service'} → trigger fills credit_note_number → notify admin via email → return human page "Tilaus peruutettu"
```

For `status='maksettu'` orders admin handles refund manually; self-service still creates hyvityslasku but admin must refund outside system.

**Admin manual flow:** Button in `src/pages/admin/tilaukset/[id].astro` → `POST /api/admin/orders/generate-credit-note` (admin session required) → same PDF generator, sets `credited_by`, optionally emails customer if `status === 'maksettu'`. Hyvityslasku is for bookkeeping; customer only receives it if they already paid.

PDF structure for credit note: same as invoice but header `HYVITYSLASKU`, negative amounts, reference `Alkuperäinen lasku: 2026-00042`, credit number `HYV-2026-00001`.

---

## 11. Email (Resend)

- Free: 3000/mo, 100/day — sufficient.
- From: `noreply@tietosiru.com` (verify domain in Resend).
- Templates: HTML via Astro or `react-email` or plain HTML string.
- Invoice email: subject `Lasku <invoice_number> — Tietosiru Oy`, body + PDF attachment + `Peruuta tilaus` link.
- No marketing emails.

---

## 12. SEO & Security

### 12.1 Robots

```txt
# public/robots.txt
User-agent: *
Disallow: /member/
Disallow: /admin/
Disallow: /api/
Allow: /
```

Plus per-page: `<meta name="robots" content="noindex, nofollow">` for member/admin.

### 12.2 Security headers

**Via `netlify.toml` (preferred for static) and mirrored in `src/middleware.ts` for SSR:**

```toml
# netlify.toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    # CSP: start lenient, tighten after audit
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co https://api.resend.com"

# Rate limiting for /api/auth/* is enforced in the Netlify Function itself
# (Netlify has no native X-RateLimit header). See src/pages/api/auth/member-login.ts
# in-memory 5 req/min/IP + 300ms delay. The _headers below are only for security headers.
# [[headers]]
#   for = "/api/auth/*"
#   [headers.values]
#     # enforced in code, not via headers
```

Meaning: `X-Frame-Options: DENY` prevents iframe clickjacking; `CSP` restricts where scripts/styles/images can load (mitigates XSS).

### 12.3 Secrets

Never expose `SUPABASE_SERVICE_ROLE_KEY` to client. Only use in server `lib/supabase.ts` with `import.meta.env` server-only.

---

## 13. Supabase Free Tier — Keep-Alive

Free projects pause after 7 days of DB inactivity (no PostgREST query). Paused = 503 until manual unpause.

**GitHub Action `.github/workflows/keep-alive.yml`:**

```yaml
name: Keep Supabase Alive
on:
  schedule: [{ cron: "0 8 */3 * *" }] # every 3 days 08:00 UTC
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -s "$SUPABASE_URL/rest/v1/products?select=id&limit=1" \
            -H "apikey: $SUPABASE_ANON_KEY" \
            -H "Authorization: Bearer $SUPABASE_ANON_KEY" -o /dev/null
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

Important: must hit a real table (triggers Postgres activity, resets timer). `/auth/v1/health` does not count.

---

## 14. Tailwind

- Upgrade Tailwind 3 → 4 when upgrading Astro.
- Public/Member share `src/styles/global.css`.
- Admin: scope Flowbite dashboard. **Even though user wants Tailwind everywhere, do not let Flowbite's admin CSS bleed** — wrap `AdminLayout.astro` in `<div class="admin-theme">` and scope `admin.css` or use Tailwind `prefix: 'admin-'` for admin config. This prevents dashboard utilities (e.g., `bg-gray-900` overrides) from affecting public pages.

```bash
npm uninstall tailwindcss @astrojs/tailwind
npm install -D tailwindcss@4 @tailwindcss/vite
```
```js
// astro.config.mjs
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({ vite: { plugins: [tailwindcss()] } })
```

---

## 15. Environment Variables

```env
# .env (not committed)
PUBLIC_SITE_URL=https://tietosiru.com
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # server only
RESEND_API_KEY=re_...
ADMIN_EMAIL=admin@tietosiru.com
MEMBER_SESSION_SECRET=random-32-chars   # HMAC for httpOnly cookie
```

Add same to Netlify env + GitHub Secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY` for keep-alive).

---

## 16. Costs — Free Tier Verification

| Service | Free quota | Expected use | Action if exceeded |
|---------|------------|--------------|--------------------|
| Netlify | 100GB BW, 300 build min, 125k func | <5GB, <100 func/day | Stay on Netlify |
| Supabase | 500MB DB, 1GB storage, 50k MAU, 5GB egress | ~50MB, ~hundreds MAU | Keep-alive prevents pause |
| Resend | 3000 emails/mo, 100/day | <100/mo | No action |

---

## 17. Implementation Roadmap (order matters)

1. **Upgrade Astro 2→7 + Tailwind 3→4 + Netlify adapter** — `npx @astrojs/upgrade`, fix build, visual regression of Flowbite admin.
2. **Supabase project + migration 001** — tables, RLS, storage bucket `invoices`, sequences, `order_cancel_logs`, `pg_cron` extension.
3. **i18n + public pages** — `astro.config.mjs` i18n, `src/i18n/*.json`, `src/content.config.ts`, build `[lang]` routes, `PublicLayout`, `robots.txt`, `Tietosuojaseloste`.
4. **Security baseline** — `middleware.ts` headers, `netlify.toml` headers + rate limit, `_headers`.
5. **Member auth** — `lib/memberAuth.ts`, `POST /api/auth/member-login`, `middleware` guard, `member/kirjaudu` page, httpOnly cookie.
6. **Products** — Supabase CRUD seed, `member/tuotteet/*` (auth-guarded, noindex), product API.
7. **Cart** — `stores/cart.ts` (localStorage + 7d eviction), `CartDrawer`, `ostoskori` page.
8. **Checkout + Orders** — `member/kassa` page, `POST /api/orders/create`, `pdf-lib` invoice, Storage upload, Resend email with cancel link.
9. **Cancel flow** — `GET /api/orders/cancel`, `order_cancel_logs`, credit note PDF, admin notification; plus `POST /api/admin/orders/generate-credit-note`.
10. **Admin** — Supabase Auth, isolate Flowbite to `AdminLayout`, CRUD for customers/products/orders, invoice/credit-note download links.
11. **Polish** — `keep-alive.yml`, GDPR text review, invoice sequence test, E2E manual test, Netlify env.

---

## 18. Testing Checklist

- [ ] `npm run build` passes on Node 20+
- [ ] Public `/`, `/en`, `/sv` prerendered + hreflang
- [ ] `/member/*` redirects to login when no cookie; no email list in DevTools/JS
- [ ] Rate limit: 6th login attempt in 60s returns 429
- [ ] Cart persists across reload, clears after 7d or logout/order
- [ ] Order creates `invoice_number` 2026-00001 sequentially, PDF in Storage + email received
- [ ] Cancel link: single-use, expires 7d, logs IP, creates `HYV-...`, notifies admin
- [ ] Admin login requires Supabase Auth; RLS blocks non-admin
- [ ] `robots.txt` + `noindex` on member/admin; Google Search Console shows no member URLs
- [ ] `pg_cron` job exists; keep-alive workflow green
- [ ] Tietosuojaseloste mentions 6y retention + purpose + rights

---

## 19. Open Notes & Follow-ups

- Domain + Resend DNS verification (SPF/DKIM) required before sending invoices.
- Decide `Y-tunnus` / company address for invoice header.
- Invoice template: confirm if Tietosiru wants logo, payment terms (e.g. 14 pv netto), bank IBAN.
- If later needing true e-invoicing, re-introduce `verkkolaskuosoite` + `välittäjätunnus` + operator API (Maventa/Apix, €/invoice).
- Update `LICENSE`, `README.md` (currently still Flowbite boilerplate).

---

*End of plan. This file is the single source of truth — update here when a decision changes.*
