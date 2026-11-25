# Payment Desk — Antigravity Agent Rules & Engineering Constitution (v2)

> **MANDATORY:** Read and obey every rule in this file before modifying any schema, server action, middleware, or UI component. These rules reflect the finalized requirements approved by the Owner and Accounts team for **INDFURN** and **VINMORE**.

---

## 1. Product Identity & Multi-Company Architecture
- **App Name:** `Payment Desk` (internal PWA — do NOT brand the app shell with a single company's logo; use a clean, standalone `Payment Desk` icon/wordmark for both mobile PWA shortcuts and desktop).
- **Fixed Two-Company Scope:** Support strictly **2 companies**:
  1. **INDFURN** — Banks: `Axis Bank` (primary vendor execution bank), `South Indian Bank (SIB)`, `HDFC Bank`, `Kotak Mahindra Bank`.
  2. **VINMORE** — Banks: `Axis Bank`, `HDFC Bank`, `Kotak Mahindra Bank` *(no SIB)*.
  - Do NOT build unnecessary "Create New Company" CRUD bloat.
- **Strict Data Isolation:** Every operational table (`company_banks`, `vendors`, `payment_items`, `audit_logs`, `notifications`, `recurring_reminders`) MUST be strictly scoped by `company_id`. INDFURN and VINMORE data must NEVER leak across workspaces.
- **Company Switcher:** Provide a clean top-bar/header switcher (`INDFURN` ↔ `VINMORE`) for users assigned access to both companies. Users assigned a single company must be locked to that company's data at both UI and database RLS layers.
- **No Public Sign-Up:** There is NO self-registration flow. Only authenticated users provisioned by an Admin can log in via `/login`.

---

## 2. Role-Based Access Control (RBAC) & Workflow
The old 2-role (`OWNER`/`ACCOUNTANT`), `STAFF` (`/bills`), and `Recommended By` (Partner) concepts are **PERMANENTLY REMOVED**.

Use **4 Operational Roles** + an **`is_admin` boolean flag** on `public.profiles`, plus a `user_company_access` mapping (`INDFURN`, `VINMORE`, or `Both`). Multiple users may be assigned to any role.

1. **Admin (`is_admin = true` — Owner / Developer):**
   - Creates, edits, enables, and disables user accounts (using `SUPABASE_SERVICE_ROLE_KEY`).
   - Assigns each user's Role (`PREPARER`, `VERIFIER`, `APPROVER`, `AUDITOR`) and Company Access (`INDFURN`, `VINMORE`, or `Both`).
   - Prevents self-deactivation.
   - Manages Company Banks per company.

2. **Preparer / Executor (`PREPARER` — Accounts Executive):**
   - Creates, edits, and deletes `DRAFT` payment entries; submits drafts to `PENDING_VERIFICATION`.
   - Manages Vendors (Add / Edit / Toggle Active).
   - Updates the current **Available Bank Balance** per company bank before/while preparing payments.
   - Views `APPROVED` ("Ready to Pay / Pending UTR") entries, exports **Bank Bulk Upload Excel**, executes transfers externally, and marks entries `PAID` by entering unique **UTR** (or **Cheque No + Cheque Date**) and uploading the **Bank Acknowledgement PDF/Receipt**.
   - Manages & views Accounts-only **Monthly Reminders** (e.g., KSEB, Staff Salary).

3. **Verifier (`VERIFIER` — Senior Accountant):**
   - Reviews `PENDING_VERIFICATION` entries (amount, TDS, due date, vendor beneficiary details).
   - Actions: **Verify** (moves entry to `PENDING_APPROVAL`) or **Return / Reject** with mandatory note (sends back to `PREPARER`).

4. **Approver (`APPROVER` — Owner / Final Authority):**
   - Reviews `PENDING_APPROVAL` entries (plus `ON_HOLD` queue).
   - **No Amount Threshold Bypass:** Every payment requires Owner approval (do not add manager auto-approval limits).
   - **Admin Override:** If a Verifier is unavailable/vacant, an Approver with override privilege may directly review/approve pending items so payments never bottleneck.
   - **Actions:** Individual **Approve**, **Bulk Approve** (checkbox multi-select), **Hold** (`ON_HOLD`), or **Reject** (`REJECTED` with mandatory reason).
   - **Zero Direct Editing by Owner:** The Approver NEVER edits financial amounts or vendor fields directly. Any correction requires Hold/Reject back to `PREPARER`.

5. **Auditor (`AUDITOR` — Read-Only Audit Role):**
   - Strictly **NO data entry and NO financial edits**.
   - Reviews `PAID` history side-by-side with the Payment Voucher and uploaded **Bank Acknowledgement PDF**.
   - Sole write action: clicking **`Mark Audited`** on a `PAID` record, which stamps `audited_by` and `audited_at` immutably.

---

## 3. Payment Lifecycle, Financial Integrity & Business Rules
- **Canonical Status Pipeline:**
  `DRAFT` → `PENDING_VERIFICATION` → `PENDING_APPROVAL` → `APPROVED` *(Pending UTR)* → `PAID` *(Completed)*
  *(Branch states: `ON_HOLD`, `REJECTED`, `CANCELLED`)*
- **No Artificial Time Locks:** Even though payment batches usually happen at 11:00 AM and 4:00 PM, NEVER lock submission or approval by clock time. Instead, capture and display exact **Audit Timestamps** for every stage (`created_at`, `submitted_at`, `verified_at`, `approved_at`, `paid_at`, `audited_at`).
- **Bank Balance & Projected Remaining Balance (Owner Decision Core):**
  - Approver overview MUST display 4 crisp figures for the active company:
    1. **Total Available Balance** (with clickable/expandable bank-wise breakdown)
    2. **Pending Verification** (total awaiting Verifier)
    3. **Pending Approval** (total awaiting Approver)
    4. **Projected Remaining Balance** (`Available Balance - Approved/Selected Total`, recalculating live as items are selected or approved)
  - Note: Internal inter-bank transfers (e.g., SIB → Axis main account) do not require approval tracking.
- **Payment Types & Modes:**
  - Support both **Exact Bill-by-Bill** (`Against Bill`, `Against PI`, `Electricity Charge`, etc.) and **On-Account / Running Balance** (round lump-sum payments such as ₹50,000 / ₹1,00,000).
  - **Payment Modes:** `NEFT_RTGS` (default) and `CHEQUE` (for rare one-time parties). Do NOT add Cash or UPI modes.
  - For `CHEQUE` settlements, capture `cheque_number` and `cheque_date` instead of UTR.
- **TDS & Net Payable:**
  - `tds` defaults to `0`. Always render `NA` when `tds === 0`.
  - `net_payable = amount - tds` must be auto-calculated consistently across UI, Server Actions, and PostgreSQL.
- **Immutability & Non-Deletion Locks (Enforced at UI, Server Action, AND PostgreSQL Trigger):**
  - Only `DRAFT` entries may be hard-deleted. Submitted records must use `CANCELLED`.
  - Once `APPROVED`, core financial fields (`company_id`, `vendor_id`, `amount`, `tds`, `invoice_ref`, `due_date`, `purpose`, `source_bank_id`, `payment_mode`) are permanently locked.
  - Terminal states (`PAID`, `REJECTED`, `CANCELLED`) are immutable — with the **sole exception** that an active `AUDITOR` (or Admin) may stamp `audited_by` and `audited_at` once on a `PAID` item.
- **Duplicate Guards:**
  - Show a clear duplicate warning when `(company_id, vendor_id, invoice_ref)` already exists (ignore placeholder refs like `NA` or `On Account`).
  - Enforce strict uniqueness on `utr_number` (catch Postgres `23505` cleanly with a human-readable message).
- **Pending UTR Visibility:** An `APPROVED` item is NOT complete until UTR/Cheque details and Bank Acknowledgement PDF are saved. Both `PREPARER` and `APPROVER` overview must clearly surface pending UTR count/amount.

---

## 4. Vendor Master & Bank Bulk Upload Excel Rules
- **Lean Vendor Schema (NO GSTIN / NO Mobile):**
  - Required fields ONLY:
    1. `party_name` — Trade/supplier display name shown in forms, tables, and approvals (e.g., `Naas Hardware`).
    2. `beneficiary_name` — Exact bank account holder name used for bank Excel export (e.g., `Manoj`).
    3. `account_number` — Beneficiary bank account number.
    4. `ifsc_code` — Uppercase 11-character IFSC code.
    5. `remarks` — Optional short note.
  - Do NOT require GSTIN or phone/mobile number.
- **Bank Bulk Import Excel Export (Replaces Tally Export):**
  - Do NOT build Tally export integrations.
  - From `APPROVED` ("Ready to Pay") items, `PREPARER` can export Bank Portal Bulk Upload `.xlsx` files.
  - **Auto Same-Bank vs Other-Bank Split:** Automatically inspect `vendor.ifsc_code` prefix (e.g., `UTIB` = Axis, `SIBL` = SIB, `HDFC` = HDFC, `KKBK` = Kotak) against the selected source bank to split and download the matching **Same-Bank** and **Other-Bank (NEFT/RTGS)** Excel templates.
  - Populate Excel rows automatically using `beneficiary_name`, `account_number`, `ifsc_code`, and `net_payable`.
  - Design the Excel exporter with a clean template-adapter pattern (starting with **Axis Bank** Same-Bank & Other-Bank templates, easily extensible to SIB/HDFC/Kotak once templates are supplied).

---

## 5. Documents, Storage & PDF Vouchers
- **Supplier Invoice Upload:** Strictly **OPTIONAL** (never block draft creation or submission if no invoice file is attached).
- **Bank Acknowledgement PDF / Receipt:** Required when marking a payment `PAID` so Approver and Auditor can verify disbursements. Manual UTR entry + PDF upload only (no AI/OCR auto-extraction in v2).
- **Private Storage Buckets:** Store files strictly in private Supabase Storage buckets (`bank-receipts`, `supplier-invoices`) with active-user Storage RLS policies and server-generated signed URLs (do NOT aggressively lock out a viewer mid-audit; generate reliable signed URLs per preview session).
- **Printable PDF Voucher (`/print`):** Provide clean A4 `@media print` / Save-as-PDF voucher sheets showing all approval timestamps, bank summary, and audit trail.

---

## 6. Notifications & Recurring Reminders
- **Workflow Notifications (In-App + PWA Web Push):**
  - `PREPARER` submits (`PENDING_VERIFICATION`) → notify `VERIFIER`.
  - `VERIFIER` verifies (`PENDING_APPROVAL`) → notify `APPROVER`.
  - `APPROVER` approves / holds / rejects → notify `PREPARER`.
  - **Do NOT** send notifications when an item is marked `PAID`.
- **Monthly Recurring Reminders:** Simple list/alert for recurring dues (e.g., KSEB, Staff Salary) visible strictly to `PREPARER` / Accounts users.

---

## 7. UI/UX Design Standards
- **Visual Language:** Plain, ultra-clean light mode (`#F8FAFC` canvas, `#FFFFFF` cards, `#E2E8F0` borders). Zero multi-color clutter, zero decorative analytics charts/graphs.
- **Brand Accent:** **Maroon** (`#7F1D1D` / `#881337` primary accent — update CSS variable `--brand-primary` immediately once exact INDFURN maroon hex is provided) paired with crisp Slate/Black text. Semantic badges used sparingly (Emerald = Paid/Approved, Amber = Pending/Hold, Rose = Rejected/Overdue).
- **Formatting & Ergonomics:**
  - Always format currency in Indian numbering (`₹1,25,000.00`) with `tabular-nums`.
  - Display **Due Date** prominently with clear **Overdue** visual cue so Approver can prioritize older dues.
  - Provide instant **Vendor Search** on Approval Queue, Payments Workspace, and History pages.
  - Mobile-first cards for `APPROVER` (easy thumb-friendly Approve/Hold/Reject & Bulk Select); high-density clean desktop tables for `PREPARER`, `VERIFIER`, and `AUDITOR`.

---

## 8. Security, Database & Performance Mandates
- **Auth & Role Caching:**
  - Cache role & active status strictly in admin-only **`app_metadata`** (`user.app_metadata`), NEVER user-writable `user_metadata`.
  - Use `React.cache()` in `src/lib/auth.ts` so `layout.tsx` and child `page.tsx` files share ONE auth + profile + company-access lookup per request.
  - Never hardcode role redirects in `src/middleware.ts`; exclude `/manifest.webmanifest`, `/sw.js`, `/_next/*`, and static assets from auth redirects.
- **Supabase & PostgreSQL Best Practices:**
  - RLS enabled on every table. `public.get_my_role()` MUST verify `AND is_active = TRUE`.
  - Always use NULL-safe comparisons (`IS DISTINCT FROM`, `v_role IS NULL OR ...`) inside PL/pgSQL triggers.
  - Use `createAdminClient()` strictly inside verified server-only actions (e.g., Admin user creation). Always use `.upsert(..., { onConflict: 'id' })` on `public.profiles` to prevent race collisions with `auth.users` triggers.
  - Never include `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;` in migrations (causes ownership error `42501` in Supabase SQL Editor).
- **Zero-Lag Performance:**
  - Run independent server queries concurrently with `Promise.all([...])`.
  - Select only required columns.
  - Provide `loading.tsx` skeletons, `<Link prefetch={true}>`, and optimistic UI updates (with rollback on error) for Approve, Verify, Hold, Reject, and Audit actions.
- **Mandatory Verification Before Task Completion:**
  - Always run `npx tsc --noEmit` and `npm run build` and confirm **0 TypeScript, ESLint, and Next.js build errors** before declaring any task done.