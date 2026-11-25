# Payment Desk — Phased Upgrade & Build Plan (v2)

> **Execution Rule:** Build and verify **one phase at a time**. At the end of every phase, run `npx tsc --noEmit` and `npm run build` (must pass with **0 errors**) and complete the phase's verification checklist before starting the next phase.

---

## Pre-Build Inputs (Can Be Dropped In Anytime)
These two external assets do NOT block Phases A–C and can be plugged in cleanly once received from the Owner / Accounts team:
1. **Exact INDFURN Maroon Hex Code** → Drop into `--brand-primary` CSS variable in `src/app/globals.css`.
2. **Official Axis Bank Bulk Upload Sample `.xlsx` Templates** (Same-Bank & Other-Bank) → Map exact column headers inside `src/lib/excel/axis-adapter.ts` in Phase D.

---

## Phase A: Database Schema v2, Multi-Company Isolation & Auth Foundation
**Goal:** Upgrade the Supabase PostgreSQL schema and Next.js auth/session layer to support 2 isolated companies (`INDFURN`, `VINMORE`), 4 operational roles + `is_admin`, and tamper-proof `app_metadata` routing.

### Deliverables
1. **Database Migration (`supabase/migrations/003_payment_desk_v2.sql`):**
   - Idempotent SQL migration (safe for Supabase SQL Editor; **never** run `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`).
   - Create `public.companies` and seed strictly `INDFURN` and `VINMORE`.
   - Update `public.user_role` (`PREPARER`, `VERIFIER`, `APPROVER`, `AUDITOR`), `public.payment_status` (add `PENDING_VERIFICATION`), and add `public.payment_mode` (`NEFT_RTGS`, `CHEQUE`), `public.payment_type` (`AGAINST_BILL`, `ON_ACCOUNT`), `public.notification_event`.
   - Update `public.profiles` (add `is_admin`) and create `public.user_company_access`.
   - Update `public.company_banks` (add `company_id`, `ifsc_prefix`, `available_balance`, `balance_updated_at`, `balance_updated_by`, `is_primary`) and seed:
     - **INDFURN:** Axis (`UTIB`, primary), SIB (`SIBL`), HDFC (`HDFC`), Kotak (`KKBK`).
     - **VINMORE:** Axis (`UTIB`, primary), HDFC (`HDFC`), Kotak (`KKBK`).
   - Update `public.vendors` to lean beneficiary schema (`company_id`, `party_name`, `beneficiary_name`, `account_number`, `ifsc_code`, `remarks`; remove mandatory GSTIN/mobile constraints).
   - Update `public.payment_items` (`company_id`, `payment_type`, `payment_mode`, `cheque_number`, `cheque_date`, `verified_by`, `verified_at`, `audited_by`, `audited_at`).
   - Create `public.notifications`, `public.push_subscriptions`, and `public.recurring_reminders`.
   - Deploy `public.get_my_role()`, `public.is_admin_user()`, `public.has_company_access(uuid)`, NULL-safe `public.enforce_payment_integrity()` trigger, idempotent `public.handle_new_user()` trigger, RLS policies, Storage RLS policies, and standard schema/table `GRANT`s.
2. **TypeScript & Auth Context:**
   - Rewrite `src/types/database.ts` to match the v2 schema.
   - Update `src/lib/auth.ts` with `React.cache()` `getCurrentUserContext()` returning `{ user, profile, allowedCompanies, activeCompany }`.
   - Create `src/actions/company.ts` (`switchActiveCompany` setting HTTP-only cookie `pd_active_company`).
   - Update `src/middleware.ts`, `src/actions/auth.ts`, and `src/app/page.tsx` for 4-role landing redirects (`PREPARER` → `/payments`, `VERIFIER` → `/verify`, `APPROVER` → `/approvals`, `AUDITOR` → `/audit`) using `app_metadata` only.

### Phase A Exit Checklist
- [ ] `003_payment_desk_v2.sql` executes cleanly in Mumbai Supabase SQL Editor.
- [ ] Admin user (`APPROVER` + `is_admin = true`, access to both companies) logs in and lands on `/approvals`.
- [ ] `npx tsc --noEmit` & `npm run build` pass with 0 errors.

---

## Phase B: `Payment Desk` Branding, Company Switcher, Admin Settings & Lean Vendors
**Goal:** Establish the standalone `Payment Desk` Maroon/Light visual identity, top workspace switcher, Admin user/bank management, and lean Beneficiary Master.

### Deliverables
1. **Branding & Theme (`globals.css`, `manifest.ts`, `login/page.tsx`, `app-shell.tsx`):**
   - Replace single-company header branding with standalone **`Payment Desk`** emblem & wordmark.
   - Apply plain light `#F8FAFC` / `#FFFFFF` palette with `--brand-primary` Maroon accent (`#7F1D1D` default, ready for exact INDFURN hex).
   - Update `src/app/manifest.ts` and PWA icons (`192x192`, `512x512`).
   - Build top header **Company Switcher** (`INDFURN` ↔ `VINMORE` for multi-company users; fixed badge for single-company users) + Role/Admin badges + Notification Bell shell.
   - Add `src/app/(dashboard)/loading.tsx` skeleton for instant transitions.
2. **Admin Settings (`/settings` — `is_admin` Only):**
   - **Team Users Tab:** Create/Edit/Enable/Disable users with Role (`PREPARER`, `VERIFIER`, `APPROVER`, `AUDITOR`), `is_admin` toggle, and Company Access checkboxes (`INDFURN`, `VINMORE`) using `createAdminClient()` + `.upsert()` on `public.profiles` + atomic rollback on failure.
   - **Company Banks Tab:** View/Add/Edit/Toggle active banks scoped to the currently active company (showing IFSC prefix & current balance).
3. **Lean Vendor Master (`/vendors`):**
   - Update `src/actions/vendors.ts`, `src/lib/validators.ts`, and `vendor-management.tsx` to strictly 5 fields: `Party Name`, `Beneficiary Name`, `Account Number`, `IFSC Code` (auto bank chip), `Remarks (Optional)`. Remove GSTIN & mobile inputs.
   - Scope all vendor queries and creations strictly to `activeCompany.id`.

### Phase B Exit Checklist
- [ ] Switching `INDFURN` ↔ `VINMORE` isolates banks and vendors completely.
- [ ] Admin creates test accounts for all 4 roles (`PREPARER`, `VERIFIER`, `APPROVER`, `AUDITOR`) with single and dual company access.
- [ ] Vendor can be saved with different `Party Name` (`Naas Hardware`) and `Beneficiary Name` (`Manoj`) without GSTIN/mobile.
- [ ] `npx tsc --noEmit` & `npm run build` pass with 0 errors.

---

## Phase C: Core 3-Stage Workflow, Live Cash Projection & Monthly Reminders
**Goal:** Deliver the complete daily Prepare → Verify → Approve loop with Owner live balance visibility, Bulk Approve, and Accounts-only Reminders.

### Deliverables
1. **Preparer Workspace (`/payments`):**
   - **Available Bank Balance Bar & Modal (`updateBankBalances`):** Preparer updates live balances per company bank with timestamp & actor attribution.
   - **Payment Entry Sheet (`payment-form-sheet.tsx`):**
     - Vendor search showing read-only Beneficiary/Account/IFSC preview.
     - `Payment Type` (`Against Bill` vs `On Account`) & `Payment Mode` (`NEFT_RTGS` vs `CHEQUE`).
     - Duplicate `(company_id, vendor_id, invoice_ref)` live warning.
     - Auto `Net Payable = Amount - TDS` (`NA` when `0`).
     - Optional Supplier Invoice upload (never blocks submit).
   - Status tabs (`Draft`, `Pending Verification`, `Pending Approval` / `On Hold`, `Ready to Pay (Pending UTR)`, `Paid`, `Rejected`) with live counts.
2. **Verifier Queue (`/verify`):**
   - Dedicated desktop-first table of `PENDING_VERIFICATION` entries showing full beneficiary details (`Beneficiary Name`, `A/C`, `IFSC`), Due Date/Overdue pills, and amounts.
   - Actions: 1-click **Verify & Forward** (`PENDING_APPROVAL`) and **Return / Reject** (mandatory note back to Preparer), with optimistic UI.
3. **Approver Dashboard & Queue (`/approvals` — Mobile-First):**
   - **4-Card Cash Overview:**
     1. `Total Available Balance` (clickable bank-wise breakdown popover)
     2. `Pending Verification`
     3. `Pending Approval`
     4. Live `Projected Remaining Balance` (`Available - (Ready to Pay + Selected)`)
   - Subtle `Pending UTR` overview indicator.
   - Instant **Vendor Search**, **Overdue Only** filter, Due Date grouping/badges.
   - Checkbox multi-select + sticky **Bulk Approve** bar (`bulkApprovePayments`).
   - Individual **Approve**, **Hold**, **Reject** (mandatory reason modal), inline Bank Switch, and Owner Override tab for `PENDING_VERIFICATION` when Verifier is unavailable. Zero direct amount editing by Owner.
4. **Accounts-Only Monthly Reminders (`/reminders` — `PREPARER` Only):**
   - CRUD checklist for recurring monthly obligations (KSEB, Staff Salary) with `Mark Done for Month` and `+ Create Payment Entry` pre-fill button. Hidden from all other roles.

### Phase C Exit Checklist
- [ ] Full 3-stage test across 3 accounts: Preparer updates balance & submits → Verifier verifies → Approver sees live Projected Remaining Balance drop as bills are checked → Bulk Approve & Reject (with reason) work smoothly.
- [ ] Owner override works on an unverified item when Verifier is absent.
- [ ] Non-Preparer users cannot view or access `/reminders`.
- [ ] `npx tsc --noEmit` & `npm run build` pass with 0 errors.

---

## Phase D: Bank Bulk Upload Excel Engine, UTR/Cheque Settlement, Auditor & A4 Voucher
**Goal:** Eliminate single-entry bank portal typing via IFSC-split Bulk Excel export, enforce UTR/Cheque + PDF proof, and enable independent read-only Auditing.

### Deliverables
1. **Bank Bulk Upload Excel Engine (`src/lib/excel/` + `/api/export/bank-excel`):**
   - Install `exceljs` (text-safe cell formatting for bank account numbers).
   - Implement `ifsc.ts` auto-splitting `APPROVED` (`NEFT_RTGS`) items into **Same-Bank** vs **Other-Bank** batches by matching `vendor.ifsc_code.slice(0, 4)` against `company_bank.ifsc_prefix`.
   - Implement `axis-adapter.ts` (Axis Bank Neo Same-Bank & Other-Bank `.xlsx` templates, automatically mapping `beneficiary_name`, `account_number`, `ifsc_code`, `net_payable`, and narration) + extensible bank adapter registry for SIB/HDFC/Kotak.
   - Add **Export Bank Bulk Excel** modal on `Ready to Pay (Pending UTR)` tab in `/payments`.
2. **Mark Paid (`mark-paid-modal.tsx`):**
   - `NEFT_RTGS`: Mandatory unique **UTR** + mandatory **Bank Acknowledgement PDF/Receipt** upload to private `bank-receipts` bucket (`<company_id>/<payment_id>/...`).
   - `CHEQUE`: Mandatory **Cheque Number** + **Cheque Date** + optional receipt copy.
   - Friendly duplicate UTR error handling (`23505`).
3. **Auditor Workspace (`/audit` — Read-Only + Audit Tick):**
   - Date-range & status filters (`Unaudited` default, `Audited`, `All`), Vendor Search, Bank filter.
   - Wide **Side-by-Side Audit Drawer**: Left = Digital Payment Voucher + full stage timestamps (`Prepared`, `Verified`, `Approved`, `Paid`); Right = embedded Bank Acknowledgement PDF via 15-min signed URL.
   - Single immutable **`Mark Audited`** button (`markPaymentAudited`). Zero financial edit/create controls visible.
4. **History & A4 PDF Voucher (`/history`, `/print`):**
   - Company-scoped filterable archive with Audit status badge, 15-min signed PDF preview, CSV export, and A4 `@media print` / Save-as-PDF voucher displaying active company header (`INDFURN` or `VINMORE`) and 4-stage timestamped sign-offs.

### Phase D Exit Checklist
- [ ] Selecting mixed Axis & Non-Axis vendors in `Ready to Pay` auto-splits and downloads separate Same-Bank and Other-Bank `.xlsx` files with `beneficiary_name` populated and intact account numbers.
- [ ] Duplicate UTR is cleanly rejected; Cheque mode requires Cheque No & Date.
- [ ] Auditor can view Bank PDF side-by-side and stamp `Audited`, and PostgreSQL rejects any attempt by Auditor to modify amounts or re-audit.
- [ ] `/print` produces a crisp A4 PDF voucher for both INDFURN and VINMORE.
- [ ] `npx tsc --noEmit` & `npm run build` pass with 0 errors.

---

## Phase E: Workflow Notifications, PWA Web Push, Security Audit & Vercel Deploy
**Goal:** Connect real-time workflow alerts across all 3 active stages, harden security, and deploy Payment Desk to production.

### Deliverables
1. **In-App & PWA Web Push Notifications:**
   - Generate VAPID keys and configure `.env.local` + Vercel env vars (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
   - Implement `src/actions/notifications.ts`, `src/lib/push.ts`, `/api/push/subscribe`, and update `public/sw.js` (`push` and `notificationclick` listeners).
   - Wire exact trigger matrix:
     - `PREPARER` submits → notify `VERIFIER`
     - `VERIFIER` verifies → notify `APPROVER`
     - `APPROVER` approves/holds/rejects (or `VERIFIER` returns) → notify `PREPARER`
     - **Zero** notification when marked `PAID`.
   - Wire interactive Notification Bell popover in `app-shell.tsx` with Mark Read / Mark All Read and deep-link navigation.
2. **Final Client Alignment & Polish:**
   - Plug in exact INDFURN Maroon hex code (if different from `#7F1D1D`).
   - Verify Axis Bank `.xlsx` export files against the official Axis Neo portal bulk import check with the Accounts team.
3. **Pre-Launch Security & Production Deployment:**
   - Run full review of `src/actions/*`, `src/app/api/*`, and `src/middleware.ts` verifying strict `company_id` scoping and zero leaked `SUPABASE_SERVICE_ROLE_KEY` imports.
   - Ensure GitHub repository is switched to **Private**.
   - Deploy to **Vercel** connected to Mumbai Supabase (`ap-south-1`), test PWA install on mobile (Android/iOS) & desktop, and complete live UAT with Owner, Verifier, Preparer, and Auditor accounts.

### Phase E Exit Checklist
- [ ] Mobile & desktop push notifications fire cleanly for Submit → Verify → Approve/Hold/Reject, and stay silent on Paid.
- [ ] PWA installs cleanly as **"Payment Desk"** with Maroon icon on phone home screen.
- [ ] GitHub repo is **Private**, Vercel production build passes with 0 errors, and all 4 roles pass live UAT.