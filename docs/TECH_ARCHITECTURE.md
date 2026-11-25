# Payment Desk — Technical Architecture Specification (v2)

## 1. Core Technology Stack & Hosting Topology
- **Framework:** Next.js (App Router, React Server Components, Server Actions, TypeScript strict mode).
- **UI & Forms:** Tailwind CSS, `shadcn/ui`, `lucide-react`, `sonner` (toasts), React Hook Form + Zod.
- **Database, Auth & Storage:** Supabase (`ap-south-1` — South Asia / Mumbai region for ~20–30ms latency from Kerala).
  - PostgreSQL with Row Level Security (RLS) & PL/pgSQL integrity triggers.
  - `@supabase/ssr` for cookie-based SSR authentication.
  - Private Supabase Storage buckets (`bank-receipts`, `supplier-invoices`).
- **Excel Generation:** `exceljs` (or `xlsx`) using a modular Bank Template Adapter pattern for `.xlsx` corporate bank bulk uploads.
- **PWA & Push Notifications:** Native Next.js `src/app/manifest.ts`, custom Service Worker (`public/sw.js`), and Web Push (`web-push` with VAPID keys) backed by `public.notifications` & `public.push_subscriptions`.
- **Hosting:** Vercel (Production deployment connected to private GitHub repository).

---

## 2. Application Directory & Route Architecture

```text
src/
├── middleware.ts                         # Session refresh + lightweight app_metadata routing (skips PWA/static assets)
├── app/
│   ├── manifest.ts                       # Payment Desk PWA manifest (Maroon/Light theme, 192/512 icons)
│   ├── globals.css                       # CSS variables (--brand-primary maroon token) + @media print rules
│   ├── layout.tsx                        # Root layout, Toaster, PWA Service Worker registration
│   ├── page.tsx                          # Role-aware root landing redirect (never hardcoded)
│   ├── login/page.tsx                    # Standalone internal Login (no public Sign Up)
│   ├── print/page.tsx                    # Printable A4 / Save-as-PDF Voucher sheet (company-scoped)
│   ├── api/
│   │   ├── export/bank-excel/route.ts    # Authenticated Bank Bulk Upload .xlsx generator (Same-Bank / Other-Bank)
│   │   └── push/subscribe/route.ts       # Saves/removes browser Web Push subscriptions
│   └── (dashboard)/
│       ├── layout.tsx                    # Authenticated shell, Company Switcher state, unread notification count
│       ├── loading.tsx                   # Instant #F8FAFC skeleton for zero-lag route transitions
│       ├── approvals/page.tsx            # APPROVER: 4-card cash overview, Projected Balance, Bulk Approve queue
│       ├── verify/page.tsx               # VERIFIER: Pending Verification table & return/verify actions
│       ├── payments/page.tsx             # PREPARER: Draft/Pending/Ready-to-Pay(Pending UTR)/Paid workspace + Balance update
│       ├── reminders/page.tsx            # PREPARER ONLY: Monthly recurring reminders (KSEB, Salary)
│       ├── audit/page.tsx                # AUDITOR: Read-only Paid queue + Side-by-side Voucher/PDF verification
│       ├── vendors/page.tsx              # Lean Vendor Master (Party Name, Beneficiary Name, A/C, IFSC)
│       ├── history/page.tsx              # Company-scoped searchable archive, CSV export, PDF voucher link
│       └── settings/page.tsx             # is_admin ONLY: Team Users (Role + Company Access) & Company Banks
├── actions/
│   ├── auth.ts                           # login, logout, createUser, updateUser, toggleUserActive (AdminClient + upsert)
│   ├── company.ts                        # switchActiveCompany (validates access & sets HTTP-only cookie)
│   ├── banks.ts                          # addCompanyBank, updateCompanyBank, toggleBankActive, updateBankBalances
│   ├── vendors.ts                        # createVendor, updateVendor, toggleVendorActive
│   ├── payments.ts                       # create/update/deleteDraft, submitForVerification, verifyPayment,
│   │                                     # approvePayment, bulkApprovePayments, holdPayment, rejectPayment,
│   │                                     # switchPaymentBank, markPaymentPaid, markPaymentAudited
│   ├── reminders.ts                      # CRUD & markMonthCompleted for recurring_reminders (PREPARER only)
│   ├── notifications.ts                  # dispatchWorkflowNotification, markNotificationRead, markAllRead
│   └── storage.ts                        # getSignedFileUrl (15-min signed URL after company access check)
├── lib/
│   ├── auth.ts                           # React.cache() getCurrentUserContext() (user + profile + allowedCompanies + activeCompany)
│   ├── supabase/
│   │   ├── client.ts                     # Browser client
│   │   ├── server.ts                     # SSR cookie-aware server client
│   │   └── admin.ts                      # Server-only SUPABASE_SERVICE_ROLE_KEY client (NEVER imported in client code)
│   ├── excel/
│   │   ├── types.ts                      # BankTemplateAdapter interface & split batch types
│   │   ├── ifsc.ts                       # IFSC 4-char prefix extraction & Same-Bank vs Other-Bank classifier
│   │   ├── axis-adapter.ts               # Axis Bank Neo Corporate Same-Bank & Other-Bank .xlsx builders
│   │   └── index.ts                      # Registry mapping bank short_code -> adapter (extensible to SIB/HDFC/Kotak)
│   ├── push.ts                           # Server-only web-push VAPID dispatcher (non-blocking, prunes 410 endpoints)
│   ├── validators.ts                     # Zod schemas for all forms & actions
│   ├── format.ts                         # Indian ₹ currency formatter, TDS NA helper, overdue days calculator
│   └── csv.ts                            # Safe RFC-4180 CSV exporter (formula-injection protected)
└── types/
    └── database.ts                       # Strongly typed v2 TypeScript interfaces matching PostgreSQL schema
3. Multi-Company Context & Strict Isolation PipelineActive Company Resolution (src/lib/auth.ts):Wrapped in React.cache() so layout.tsx and child page.tsx components execute at most ONE auth + profile + company-access resolution per HTTP request.Reads the HTTP-only cookie pd_active_company ('INDFURN' or 'VINMORE').Validates the cookie value strictly against the user's allowedCompanies (fetched from public.user_company_access, or both companies if is_admin = true).If the cookie is missing or unauthorized, automatically defaults to allowedCompanies[0].Company Switching (src/actions/company.ts):Server Action switchActiveCompany(companyId) verifies allowedCompanies membership, sets the pd_active_company HTTP-only cookie (sameSite: 'lax', path: '/'), and calls revalidatePath('/', 'layout').Never Trust Client company_id:Every Server Action and API Route resolves company_id from the validated server context (or verifies the passed company_id against allowedCompanies) before querying Supabase.PostgreSQL RLS (public.has_company_access(company_id)) acts as the final unbypassable isolation wall.4. Auth, RBAC & Zero-Lag Performance Architecture4.1 Middleware (src/middleware.ts)Refreshes Supabase SSR auth cookies cleanly on protected routes.Strict Matcher Exclusions: Must exclude _next/static, _next/image, favicon.ico, manifest.webmanifest, sw.js, and image/icon extensions so PWA manifest & service worker NEVER redirect to /login.Tamper-Proof Role Routing: Reads role strictly from admin-only user.app_metadata?.role (and is_admin from user.app_metadata?.is_admin). If metadata is missing, never assumes a fallback role — lets the request pass to the Server Component layer (getCurrentUserContext()), which reads public.profiles and syncs app_metadata in the background.4.2 Role Landing & Guard MatrixPREPARER → /paymentsVERIFIER → /verifyAPPROVER → /approvalsAUDITOR → /auditCross-role access attempts redirect cleanly to the user's own landing route. /settings strictly requires profile.is_admin === true. /reminders strictly requires profile.role === 'PREPARER'.4.3 Latency Elimination PatternsParallel Fetching: Every server page.tsx runs independent Supabase queries via Promise.all([...]).Lean Projections: Explicit column lists on .select(...) (no blind select('*') with nested joins).Optimistic UI: High-frequency actions (Verify, Approve, Bulk Approve, Hold, Reject, Switch Bank, Mark Audited) update client state immediately with clean rollback on error.Skeletons & Prefetch: (dashboard)/loading.tsx + <Link prefetch={true}> eliminate perceived route latency.5. Live Cash Balance & Projected Remaining Balance EngineDesigned to give the Owner (APPROVER) instant cash-outflow clarity before clicking Approve:Server Aggregation (on /approvals load):totalAvailableBalance = $\sum \text{company\_banks.available\_balance}$ (active banks of current company).pendingVerificationTotal = $\sum \text{net\_payable}$ where status = 'PENDING_VERIFICATION'.pendingApprovalTotal = $\sum \text{net\_payable}$ where status = 'PENDING_APPROVAL'.readyToPayTotal = $\sum \text{net\_payable}$ where status = 'APPROVED' (Pending UTR).Client Live Projection (0ms recalculation):As the Owner checks/unchecks bills for Bulk Approve, selectedTotal updates in React memory:$$\text{projectedRemainingBalance} = \text{totalAvailableBalance} - (\text{readyToPayTotal} + \text{selectedTotal})$$When an item is approved optimistically, it shifts into readyToPayTotal immediately so projectedRemainingBalance stays accurate without waiting for a page reload.6. Bank Bulk Upload Excel Engine (src/lib/excel/)Replaces single-entry manual typing on corporate banking portals (e.g., Axis Bank Neo for Corporates).6.1 Auto Same-Bank vs. Other-Bank Split (ifsc.ts)Every company_bank stores its 4-character ifsc_prefix (UTIB, SIBL, HDFC, KKBK).For every selected APPROVED payment item with payment_mode = 'NEFT_RTGS':Extract vendorPrefix = vendor.ifsc_code.trim().toUpperCase().slice(0, 4).If vendorPrefix === sourceBank.ifsc_prefix → routed to SAME_BANK batch.Otherwise → routed to OTHER_BANK (NEFT/RTGS) batch.(Items with payment_mode = 'CHEQUE' are automatically excluded from bank bulk Excel export.)6.2 Adapter Pattern (axis-adapter.ts + Registry)Each bank implements a BankTemplateAdapter:TypeScriptinterface BankTemplateAdapter {
  bankShortCode: string;
  buildSameBankWorkbook(rows: BulkExportRow[]): Promise<Buffer>;
  buildOtherBankWorkbook(rows: BulkExportRow[]): Promise<Buffer>;
}
Data Mapping Rules:Always maps vendor.beneficiary_name (NOT vendor.party_name), vendor.account_number, vendor.ifsc_code, payment.net_payable, and payment.invoice_ref / narration.Formats account numbers strictly as text cells so Excel never strips leading zeros or converts long account numbers into scientific notation (1.23E+15).Rollout Strategy: Phase 1 ships with Axis Bank Same-Bank & Other-Bank templates (columns aligned to the exact official Axis Neo sample .xlsx templates provided by the Accounts team). Adding SIB, HDFC, or Kotak later requires only dropping in a new adapter file and registering it in src/lib/excel/index.ts.Download Endpoint (/api/export/bank-excel): Validates active PREPARER (or is_admin) session + company access, verifies all requested payment_ids are APPROVED and belong to the active company, generates the requested .xlsx buffer (same_bank or other_bank), and returns Content-Disposition: attachment.7. Workflow Notifications & PWA Push Pipeline7.1 Trigger MatrixEventTriggered ByRecipients (within same company_id)SUBMITTED_FOR_VERIFICATIONPREPARER submits draftActive VERIFIER usersVERIFIED_FOR_APPROVALVERIFIER verifies entryActive APPROVER usersAPPROVED / HELD / REJECTEDAPPROVER (or VERIFIER on return)The entry's PREPARER (created_by) + company PREPARER usersMarked PAIDPREPARERNone (explicitly disabled per Owner requirement)7.2 Delivery Architecture (Non-Blocking)In-App Notification: Server Action inserts rows into public.notifications (using createAdminClient() so cross-user notification inserts succeed cleanly). The header bell badge reflects unread count and updates on navigation/refresh (or lightweight Supabase Realtime subscription on notifications filtered by recipient_user_id).PWA Web Push (src/lib/push.ts + public/sw.js):Users opt in via a non-intrusive "Enable Push Alerts" button in the header/settings, which registers the Service Worker and POSTs the browser PushSubscription to /api/push/subscribe.When a workflow notification is dispatched, sendPushToUsers(...) fires asynchronously (never blocking the main Server Action response), sending a concise payload { title, body, url } via web-push VAPID.Expired/uninstalled endpoints (404 / 410) are automatically deleted from public.push_subscriptions.Clicking a mobile/desktop notification in public/sw.js focuses the app and navigates straight to the target URL (e.g., /approvals or /verify).8. Private Storage & Signed Document PipelineUpload Flow (PREPARER):Client validates file size ($\le 5\text{ MB}$) and MIME type (PDF, JPEG, PNG, WEBP).Uploads directly via Supabase Storage client to <company_id>/<payment_item_id>/<timestamp>_<filename> inside bank-receipts (Bank Acknowledgement PDF) or supplier-invoices (optional).Storage RLS confirms active PREPARER role + company access.Preview Flow (src/actions/storage.ts):Verifies active user + company_id match before generating a 15-minute signed URL (createSignedUrl(path, 900)), ensuring Auditors and Approvers can review PDFs side-by-side without premature timeouts.9. Printable A4 PDF Voucher (/print)Server component fetches company-scoped filtered payments (or a specific batch/voucher) with full user names and timestamps (Prepared, Verified, Approved, Paid, Audited).Uses dedicated @media print CSS (@page { size: A4 portrait; margin: 12mm; }, clean hairline borders, break-inside: avoid on rows/totals, hiding app chrome/buttons) so pressing Print / Save as PDF produces a crisp archive-ready document.10. Environment Variables & Deployment ChecklistCode snippet# Supabase (Mumbai ap-south-1)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# PWA Web Push (VAPID keys — generate once via `npx web-push generate-vapid-keys`)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@indfurn.com
Keep GitHub repository Private before and after Vercel deployment.Configure all environment variables in Vercel Project Settings (Production & Preview).Verify npx tsc --noEmit and npm run build pass with 0 errors before every release.