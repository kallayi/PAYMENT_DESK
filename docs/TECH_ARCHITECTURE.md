# 04 — Technical Architecture & Folder Structure: INDFURN PayFlow PWA

## 1. Core Tech Stack (Lean & Production-Ready)
Designed for fast solo development, zero unnecessary abstractions, and high reliability with AI coding agents.

| Layer | Technology | Package / Version |
| :--- | :--- | :--- |
| **Framework** | Next.js (App Router, TypeScript) | `next` (v15+), `react`, `typescript` |
| **Styling & UI** | Tailwind CSS + shadcn/ui + Lucide Icons | `tailwindcss`, `lucide-react`, `clsx`, `tailwind-merge`, `sonner` |
| **Database & Auth** | Supabase (PostgreSQL + SSR Auth + Private Storage) | `@supabase/supabase-js`, `@supabase/ssr` |
| **Forms & Validation** | React Hook Form + Zod | `react-hook-form`, `@hookform/resolvers`, `zod` |
| **Date & Formatting** | `date-fns` + Native `Intl.NumberFormat('en-IN')` | `date-fns` |
| **PWA Support** | Next.js Native `app/manifest.ts` + Lightweight Service Worker | Built-in Next.js Metadata API |
| **Print & Export** | Dedicated A4 `@media print` Route + Native CSV Export | Zero heavy PDF-bundler dependencies |
| **Deployment** | Vercel (HTTPS + Preview Deploys) + Supabase Cloud | — |

> **Why Native `@media print` instead of `@react-pdf/renderer`?**
> Native CSS print layout (`/print?date=YYYY-MM-DD`) avoids SSR bundling crashes, renders Indian Rupee (`₹`) fonts flawlessly, and lets the Accountant click **Print / Save as PDF** directly from Chrome/Edge on A4 paper.

---

## 2. Environment Variables (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=[https://your-project-id.supabase.co](https://your-project-id.supabase.co)
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# SERVER-ONLY — NEVER prefix with NEXT_PUBLIC_
# Used strictly by Owner's User Management action to create staff/accountant accounts
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
3. Clean Project Folder Structure
Plaintext
indfurn-payflow/
├── .agent/
│   └── rules/
│       └── indfurn-rules.md          # Copy of 05_AGENT_RULES.md
├── docs/
│   ├── 01_PROJECT_OVERVIEW.md
│   ├── 02_UI_UX_DESIGN.md
│   ├── 03_DATABASE_SECURITY.md
│   ├── 04_TECH_ARCHITECTURE.md
│   └── 06_BUILD_PLAN.md
├── public/
│   ├── icons/
│   │   ├── icon-192x192.png
│   │   └── icon-512x512.png
│   └── sw.js                         # Minimal PWA installability service worker
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql    # Full SQL from 03_DATABASE_SECURITY.md
└── src/
    ├── middleware.ts                 # Auth session refresh & role-based route protection
    ├── app/
    │   ├── layout.tsx                # Inter font, PWA meta tags, Toaster (sonner)
    │   ├── globals.css               # Tailwind + @media print rules
    │   ├── manifest.ts               # Dynamic PWA Web App Manifest
    │   ├── login/
    │   │   └── page.tsx              # Clean login card
    │   ├── (dashboard)/              # Authenticated layout (Sidebar + Mobile Bottom Nav)
    │   │   ├── layout.tsx            # Fetches user + profile; enforces auth
    │   │   ├── approvals/
    │   │   │   └── page.tsx          # OWNER primary screen (Mobile-first cards)
    │   │   ├── payments/
    │   │   │   └── page.tsx          # ACCOUNTANT primary screen (Tabs + Table)
    │   │   ├── bills/
    │   │   │   └── page.tsx          # STAFF primary screen (Upload + My Uploads)
    │   │   ├── history/
    │   │   │   └── page.tsx          # OWNER & ACCOUNTANT search, filter & CSV export
    │   │   ├── vendors/
    │   │   │   └── page.tsx          # Vendor master management
    │   │   └── settings/
    │   │       └── page.tsx          # OWNER only: Company Banks & Team User Accounts
    │   └── print/
    │       └── page.tsx              # Clean A4 Payment Approval Form (no sidebar/nav)
    ├── actions/                      # Next.js Server Actions ('use server')
    │   ├── auth.ts                   # login, logout, createUser (Owner only)
    │   ├── bills.ts                  # uploadIncomingBill, dismissBill
    │   ├── payments.ts               # createPayment, updateDraft, submitPayment,
    │   │                             # ownerApprove, ownerHold, ownerReject, ownerSwitchBank,
    │   │                             # markPaidWithUtr, cancelPayment, checkDuplicateInvoice
    │   ├── vendors.ts                # createVendor, updateVendor
    │   └── storage.ts                # getSignedFileUrl (5-min expiry)
    ├── components/
    │   ├── ui/                       # shadcn/ui primitives (button, card, dialog, sheet, etc.)
    │   ├── layout/
    │   │   ├── app-shell.tsx         # Desktop Sidebar + Mobile Top Bar + Bottom Nav
    │   │   └── pwa-register.tsx      # Registers /sw.js cleanly on client
    │   ├── payments/
    │   │   ├── payment-form-sheet.tsx
    │   │   ├── owner-approval-card.tsx
    │   │   ├── mark-paid-modal.tsx
    │   │   ├── payment-detail-drawer.tsx
    │   │   └── status-badge.tsx
    │   └── bills/
    │       └── upload-bill-form.tsx
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts             # Browser Supabase client
    │   │   ├── server.ts             # Server Component / Server Action client
    │   │   └── admin.ts              # Service-role client (strictly for Owner user creation)
    │   ├── validators.ts             # Shared Zod schemas (Payment, UTR, Bill, Vendor)
    │   ├── format.ts                 # formatINR(), formatDate(), formatShortDate()
    │   └── csv.ts                    # Safe CSV export helper with formula-injection protection
    └── types/
        └── database.ts               # Strict TypeScript interfaces matching SQL schema
4. Middleware & Role Routing (src/middleware.ts)
Unauthenticated users visiting any route except /login -> redirect to /login.

Authenticated users visiting / or /login -> redirect automatically based on profiles.role:

OWNER -> /approvals

ACCOUNTANT -> /payments

STAFF -> /bills

Strict Role Guards:

STAFF trying to visit /approvals, /payments, /history, /settings, /print -> redirect to /bills.

ACCOUNTANT trying to visit /approvals or /settings -> redirect to /payments.

Inactive user (is_active === false) -> sign out & redirect to /login?error=disabled.

5. Server Action Architecture & Standard Response Format
All mutations MUST use Next.js Server Actions in src/actions/ (avoid creating redundant /api/* routes unless needed).

Standard Return Type
TypeScript
export type ActionResult<T undefined> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };
Mandatory Execution Steps Inside Every Server Action
Call const { data: { user } } = await supabase.auth.getUser() — reject immediately if missing.

Verify user's role and is_active status from profiles.

Validate incoming payload using Zod (safeParse).

Execute database query/mutation (relying on PostgreSQL RLS + Triggers as the second line of defense).

Map PostgreSQL error codes cleanly (e.g., 23505 on idx_payment_items_unique_utr -> "This UTR number is already used on another payment.").

Call revalidatePath(...) for affected routes and return ActionResult.

6. File Upload & Viewing Flow (Private Buckets)
Upload (Client -> Supabase Storage directly using authenticated session):

Validate file type (PDF, JPG, PNG, WEBP) and size (<= 5MB) before upload.

Generate path: ${year}/${month}/${crypto.randomUUID()}.${ext}.

Upload to supplier-invoices (invoices/PIs) or bank-receipts (Axis/SIB receipts).

Save ONLY the relative file_path string in PostgreSQL—never save a full URL.

View / Download (Server Action):

Call getSignedFileUrl(bucket, filePath) in src/actions/storage.ts.

Action verifies user role (blocks STAFF from bank-receipts), calls createSignedUrl(filePath, 300), and returns the 5-minute temporary URL to render an inline <img> or <a target="_blank"> PDF link.

7. PWA Setup (Mobile Installable)
src/app/manifest.ts:

name: "INDFURN PayFlow"

short_name: "INDFURN Pay"

display: "standalone"

background_color: "#F8FAFC"

theme_color: "#1E293B"

start_url: "/"

public/sw.js: Lightweight service worker implementing install, activate, and basic network-first fetch passthrough (never cache authenticated financial API responses offline to avoid stale balance/approval data).

Add Apple mobile web app meta tags in src/app/layout.tsx (appleWebApp: { capable: true, title: "INDFURN Pay" }).