# 06 — Phased Build Plan & Agent Prompts: INDFURN PayFlow

> **How to use this plan with Antigravity (Flash Model):**
> Execute **one Phase per prompt**. Test each phase in your browser before moving to the next. This prevents complexity creep and keeps code clean.

---

## Pre-Flight Manual Setup (Do Once Before Phase 1 — ~5 mins)
1. Create a new Supabase project (`indfurn-payflow`).
2. In Supabase Dashboard -> **Authentication -> Providers -> Email**:
   - Keep Email enabled.
   - Disable "Allow new users to sign up" (Owner creates accounts internally).
3. In Supabase Dashboard -> **Storage**:
   - Create Private Bucket 1: `supplier-invoices` (`Public = OFF`, max 5MB).
   - Create Private Bucket 2: `bank-receipts` (`Public = OFF`, max 5MB).
4. Copy `.env.local` values (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
5. Place `docs/01_*.md` through `docs/06_*.md` in your workspace and copy `05_AGENT_RULES.md` to `.agent/rules/indfurn-rules.md`.

---

## Phase 1: Foundation, Database, Auth & Role Middleware
**Goal:** Working Next.js app connected to Supabase with full SQL schema applied, clean Login screen, and role-based redirects.

**Tasks:**
- Initialize Next.js (App Router, TypeScript, Tailwind CSS) and install core dependencies (`@supabase/supabase-js`, `@supabase/ssr`, `zod`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`, `sonner`, `date-fns`).
- Initialize `shadcn/ui` and add essential components (`button`, `card`, `input`, `label`, `select`, `badge`, `dialog`, `sheet`, `tabs`, `table`, `textarea`, `separator`).
- Save `supabase/migrations/001_initial_schema.sql` using the exact SQL from `docs/03_DATABASE_SECURITY.md` (apply it in Supabase SQL Editor).
- Build `src/lib/supabase/{client,server,admin}.ts`, `src/lib/format.ts`, `src/types/database.ts`.
- Build `src/middleware.ts` for auth refresh and strict role route guards.
- Build `/login` page matching `docs/02_UI_UX_DESIGN.md`.

**Copy-Paste Prompt for Antigravity:**
> Read `docs/03_DATABASE_SECURITY.md`, `docs/04_TECH_ARCHITECTURE.md`, and follow `.agent/rules/indfurn-rules.md`. Complete **Phase 1** of `docs/06_BUILD_PLAN.md` only: set up dependencies, shadcn/ui, Supabase clients, formatting helpers, TypeScript types, auth middleware, and the `/login` page. Do not build dashboard screens yet.

**Manual Verification:**
- Run SQL migration in Supabase SQL Editor.
- Create 3 test users in Supabase Auth (`owner@indfurn.com`, `accounts@indfurn.com`, `staff@indfurn.com`) and insert matching rows in `public.profiles` with roles `OWNER`, `ACCOUNTANT`, `STAFF`.
- Confirm logging in as each user redirects to `/approvals`, `/payments`, and `/bills` respectively.

---

## Phase 2: App Shell (Responsive Nav) & Master Data (Vendors, Banks, Users)
**Goal:** Clean light-mode layout that feels great on both laptop and phone, plus Vendor/Bank/User management.

**Tasks:**
- Build `src/components/layout/app-shell.tsx` (Slim desktop left sidebar + Mobile top bar + Fixed bottom tab bar tailored per role).
- Build `/vendors` page (Accountant & Owner): list, search, add, edit vendors (Name, GSTIN, Bank A/C, IFSC).
- Build `/settings` page (Owner only):
  - Manage Company Banks (verify default `Axis Bank` & `South Indian Bank` load cleanly; allow adding/toggling banks).
  - Manage Team Users (create new Staff/Accountant user via Server Action using `admin.ts`, toggle `is_active`).

**Copy-Paste Prompt for Antigravity:**
> Read `docs/02_UI_UX_DESIGN.md` (Sections 3 & 4) and complete **Phase 2** of `docs/06_BUILD_PLAN.md`: build the responsive App Shell (desktop sidebar + mobile bottom tabs per role), the `/vendors` page, and the Owner-only `/settings` page (Banks & Team Users). Keep the UI minimal with zero clutter.

**Manual Verification:**
- Test responsive view at `390px` (mobile) and `1280px` (desktop).
- Add 2 sample vendors (`VINMORE`, `Ariham Industries`).

---

## Phase 3: Stock Staff Invoice Upload Flow (`/bills`)
**Goal:** Ultra-simple mobile screen for Stock Staff to snap/upload supplier invoices and send them to the Accountant.

**Tasks:**
- Build `src/actions/storage.ts` (`getSignedFileUrl`) and `src/actions/bills.ts` (`uploadIncomingBill`, `dismissIncomingBill`).
- Build `/bills` page:
  - Simple upload card: File picker (`image/*,application/pdf`, max 5MB, direct upload to `supplier-invoices` bucket), Vendor select (or fallback name), Invoice/PI Ref, optional Amount, Note.
  - "My Recent Uploads" list showing simple status badges (`Waiting for Accountant` / `Added to Payment Queue`).

**Copy-Paste Prompt for Antigravity:**
> Read `docs/01_PROJECT_OVERVIEW.md` (Step 1) and `docs/02_UI_UX_DESIGN.md` (Screen D). Complete **Phase 3** of `docs/06_BUILD_PLAN.md`: implement private storage signed URL action, incoming bill actions, and the mobile-first `/bills` screen for Stock Staff.

**Manual Verification:**
- Log in as `STAFF`, upload a test invoice photo/PDF, confirm it appears in "My Recent Uploads", and confirm `STAFF` gets redirected if trying to open `/payments` or `/approvals`.

---

## Phase 4: Accountant Workspace (`/payments`)
**Goal:** Fast desktop-friendly workspace to convert incoming bills or add entries, detect duplicate invoices, and submit to Owner.

**Tasks:**
- Build `src/actions/payments.ts` (Part 1: `createPayment`, `updateDraftPayment`, `submitPayment`, `deleteDraftPayment`, `cancelPayment`, `checkDuplicateInvoice`).
- Build `src/components/payments/payment-form-sheet.tsx`:
  - All physical form fields (`Date`, `Vendor` with inline quick-add, `Invoice/Ref No` with amber duplicate warning, `Due Date`, `Purpose` preset chips, `Amount`, `TDS`, live `Net Payable`, `Source Bank`, `Invoice Upload`, `Remarks`).
  - `Save as Draft` and `Submit for Approval` actions.
- Build `/payments` page:
  - Status tabs with counts: `Incoming Bills`, `Draft`, `Pending`, `Ready to Pay`, `Paid`, `Rejected`.
  - Clean 7-column desktop table (collapses to cards on mobile) with bottom Total row.
  - "Create Payment" action directly from an `Incoming Bill` row (pre-fills vendor, ref, amount, and links `incoming_bill_id` + `invoice_file_path`).

**Copy-Paste Prompt for Antigravity:**
> Read `docs/02_UI_UX_DESIGN.md` (Screen C) and `docs/03_DATABASE_SECURITY.md`. Complete **Phase 4** of `docs/06_BUILD_PLAN.md`: build the Accountant `/payments` workspace, status tabs, Incoming Bills conversion, Payment Entry slide-over form with inline duplicate invoice warning, and Draft/Submit actions.

**Manual Verification:**
- Log in as `ACCOUNTANT`, convert the Staff bill into a payment entry, add 2 more entries (e.g., `Axis` and `SIB`), test duplicate invoice warning, and submit them to `PENDING_APPROVAL`.

---

## Phase 5: Owner Mobile-First Approval & Detail Drawer (`/approvals`)
**Goal:** 60-second thumb-friendly approval experience for the Owner with inline bank override and document preview.

**Tasks:**
- Extend `src/actions/payments.ts` (Part 2: `ownerApprovePayment`, `ownerHoldPayment`, `ownerRejectPayment`, `ownerSwitchBank`).
- Build `src/components/payments/payment-detail-drawer.tsx`:
  - Full payment breakdown, inline Invoice & Bank Receipt viewer (using 5-min Signed URLs), and collapsible Audit Log timeline (`audit_logs` joined with user names).
- Build `/approvals` page (Owner):
  - Compact top summary strip: Total Pending Amount + `Axis` / `SIB` split pills.
  - Tabs: `Pending` and `On Hold`.
  - Date-grouped clean 4-row approval cards (`owner-approval-card.tsx`) with inline Bank switcher (`Axis` ↔ `SIB`), `View Bill` button, and `Approve` / `Hold` / `Reject` (with required reason modal).

**Copy-Paste Prompt for Antigravity:**
> Read `docs/02_UI_UX_DESIGN.md` (Screens B & E). Complete **Phase 5** of `docs/06_BUILD_PLAN.md`: build the Owner mobile-first `/approvals` screen (compact summary bar, date-grouped approval cards, inline bank switcher, Approve/Hold/Reject dialogs) and the shared Payment Detail Drawer with Signed URL invoice viewer and Audit Log timeline.

**Manual Verification:**
- Log in as `OWNER` on mobile viewport (`390px`), open a bill preview, switch one item's bank from `Axis` to `SIB`, approve two items, reject one with a reason, and verify the Audit Log records every step.

---

## Phase 6: UTR Reconciliation, History, Printable INDFURN Form & PWA Polish
**Goal:** Complete the post-payment cycle (UTR + Bank Receipt), searchable history, A4 official print sheet, CSV export, and installable PWA.

**Tasks:**
- Extend `src/actions/payments.ts` (Part 3: `markPaidWithUtr`) — enforces unique UTR error handling and locks record as `PAID`.
- Build `src/components/payments/mark-paid-modal.tsx` triggered from Accountant's `Ready to Pay` tab (read-only locked Vendor/Amount/Bank + required UTR input + required Bank Receipt upload to `bank-receipts` bucket).
- Build `/history` page (Owner & Accountant): Search by Vendor/Invoice/UTR, filter by Date Range, Status, Bank, Total summary, and `Export CSV` (`src/lib/csv.ts`).
- Build `/print` route (`/print?date=YYYY-MM-DD`): Clean A4 printable replica of INDFURN's `Payment Approval Form` (exact columns, `NA` for `0` TDS, Total row, `Prepared By` & `Approved By` timestamps, and `Print / Save PDF` button).
- Add PWA files (`src/app/manifest.ts`, `public/sw.js`, `src/components/layout/pwa-register.tsx`, icons) and run final `npx tsc --noEmit` & production build check (`npm run build`).

**Copy-Paste Prompt for Antigravity:**
> Read `docs/02_UI_UX_DESIGN.md` (Screens F & G) and `docs/04_TECH_ARCHITECTURE.md` (Section 7). Complete **Phase 6** of `docs/06_BUILD_PLAN.md`: implement the `Mark Paid / Enter UTR` modal (with bank receipt upload and duplicate UTR error handling), `/history` search + CSV export, the A4 `/print` INDFURN Payment Approval Form, and PWA manifest/service worker setup. Run `npm run build` to verify zero errors.

**Final End-to-End Security & Flow Check:**
1. Verify an `APPROVED` item CANNOT have its amount edited via UI or direct API call (blocked by DB trigger).
2. Verify entering an existing UTR returns a friendly duplicate error.
3. Verify `/print?date=YYYY-MM-DD` prints cleanly on A4 paper without sidebar/navigation clutter.
4. Deploy to Vercel, open on mobile Chrome/Safari, and tap **Add to Home Screen** to verify PWA install.