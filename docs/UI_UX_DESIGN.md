# Payment Desk — UI/UX Design Specification (v2)

## 1. Visual Identity & Design Philosophy
- **Product Name:** `Payment Desk` (standalone neutral branding — do NOT use a single company logo in the main app shell).
- **App Icon / PWA Mark:** Minimal geometric monogram/desk emblem in Maroon & White, sized cleanly for mobile home-screen shortcuts (`192x192`, `512x512`) and desktop favicons.
- **Aesthetic Direction:** Ultra-clean, plain, eye-friendly **Light Mode**. Zero multi-color noise, zero decorative charts/graphs, zero unnecessary animations. Every pixel exists for rapid financial clarity and zero-mistake execution.

### Color Tokens (`globals.css` CSS Variables)
Update `--brand-primary` immediately when the exact INDFURN maroon hex code is supplied.

| Token | Value (Default) | Usage |
| :--- | :--- | :--- |
| `--bg-canvas` | `#F8FAFC` | Global app background |
| `--bg-surface` | `#FFFFFF` | Cards, drawers, tables, modals |
| `--border-subtle` | `#E2E8F0` | Crisp 1px hairlines & dividers |
| `--text-primary` | `#0F172A` | Primary headings, amounts, vendor names |
| `--text-secondary` | `#475569` | Labels, metadata, timestamps |
| `--brand-primary` | `#7F1D1D` *(Maroon)* | Primary buttons, active tab indicators, focus rings |
| `--brand-primary-hover` | `#991B1B` | Primary hover state |
| `--brand-tint` | `#FEF2F2` | Subtle active sidebar pill / highlight background |
| `--status-success` | `#047857` / `#ECFDF5` | `APPROVED`, `PAID`, `AUDITED` badges |
| `--status-warning` | `#B45309` / `#FFFBEB` | `PENDING_VERIFICATION`, `PENDING_APPROVAL`, `ON_HOLD` |
| `--status-danger` | `#BE123C` / `#FFF1F2` | `REJECTED`, `OVERDUE`, negative projected balance |

### Typography & Data Formatting
- **Font:** Clean sans-serif (`Inter` / system UI).
- **Financial Figures:** Always use `tabular-nums` (`font-variant-numeric: tabular-nums`) and Indian numbering format (`₹12,70,000.00`).
- **TDS Display Rule:** Always display `NA` when `tds === 0`; otherwise show formatted ₹ value.
- **Touch Ergonomics:** All mobile interactive elements (buttons, checkboxes, tabs) MUST have a minimum tap target of `44px × 44px`.

---

## 2. Global App Shell & Navigation (`app-shell.tsx`)

### Top Header Bar (Desktop & Mobile)
1. **Left:** `Payment Desk` icon + title.
2. **Center / Left-Adjacent — Company Switcher:**
   - For users assigned **Both** companies: Crisp segmented toggle or dropdown (`INDFURN` ↔ `VINMORE`) with clear active indicator. Switching companies immediately refreshes all workspace data, bank balances, and queues for that company only.
   - For single-company users: Read-only subtle company badge (`INDFURN` or `VINMORE`).
3. **Right:**
   - **Notification Bell:** Unread count badge; clicking opens a clean slide-over / popover listing workflow alerts (`Submitted`, `Verified`, `Approved/Held/Rejected`). Clicking an alert navigates directly to that payment item.
   - **User Pill:** User's `full_name` + high-contrast Role Badge (`PREPARER`, `VERIFIER`, `APPROVER`, `AUDITOR`, plus `ADMIN` if `is_admin = true`) + Sign Out.

### Role-Specific Navigation Matrix
*(Desktop: compact left sidebar; Mobile: clean sticky bottom navigation bar — max 4 items)*

| Role | Default Landing Route | Visible Navigation Items |
| :--- | :--- | :--- |
| **`PREPARER`** | `/payments` | **Payments** (`/payments`), **Vendors** (`/vendors`), **Reminders** (`/reminders`), **History** (`/history`) |
| **`VERIFIER`** | `/verify` | **Verify Queue** (`/verify`), **History** (`/history`) |
| **`APPROVER`** | `/approvals` | **Approvals** (`/approvals`), **History** (`/history`), *(+ **Settings** `/settings` if `is_admin`)* |
| **`AUDITOR`** | `/audit` | **Audit Queue** (`/audit`), **History** (`/history`) |
| **Any Role + `is_admin`** | Role's landing route | Adds **Settings** (`/settings`) tab |

---

## 3. Screen-by-Screen UX Specifications

### 3.1 Login Screen (`/login`)
- Centered white card on `#F8FAFC` canvas (`max-w-sm`).
- `Payment Desk` emblem + title + subtitle (`Internal Payment Approval Portal`).
- Email/Username input, Password input (with show/hide toggle), full-width Maroon/Slate **Sign In** button.
- **No "Sign Up" or "Create Account" link** (internal provisioned accounts only).
- Clean inline error banner for invalid credentials or disabled accounts.

---

### 3.2 Approver Dashboard & Queue (`/approvals` — Mobile-First Owner View)
Designed primarily for rapid one-handed mobile review while traveling or in meetings, scaling gracefully to desktop.

1. **4-Card Financial Overview Strip (Active Company):**
   - **Card 1 — Total Available Balance:** Sum of active company bank balances. Clicking opens a compact breakdown popover/drawer showing individual bank balances (`Axis`, `SIB`, `HDFC`, `Kotak`) + *"Updated by [Name] at [Time]"*.
   - **Card 2 — Pending Verification:** Total ₹ and item count currently with Verifier.
   - **Card 3 — Pending Approval:** Total ₹ and item count waiting for Owner right now.
   - **Card 4 — Projected Remaining Balance:** Live formula `Available Balance - (Approved Ready-to-Pay + Currently Selected Items)`. Recalculates **instantly** as the Owner ticks checkboxes or approves items. Turns subtle Rose warning if balance drops negative.
2. **Pending UTR Visibility Banner (Subtle):**
   - Compact inline indicator when `APPROVED` items are still awaiting UTR/Bank PDF upload (e.g., *"3 Approved payments (₹2,45,000) awaiting UTR upload"*).
3. **Queue Tabs & Search Controls:**
   - Tabs: `Pending Approval` *(default)*, `On Hold`, `Awaiting Verification` *(read + Owner override if Verifier is absent)*, `Pending UTR` *(overview only)*.
   - Instant **Vendor Search** input (matches `party_name`, `invoice_ref`, or `purpose`) + **Overdue Only** quick filter + Bank filter.
4. **Sticky Bulk Approve Action Bar:**
   - Appears smoothly when 1 or more cards are checked: displays `Selected: N bills · ₹X,XX,XXX` alongside a primary **Bulk Approve** button (with quick confirmation).
5. **Approval Cards (Grouped by Due Date / Date):**
   - **Header Row:** Checkbox (for bulk select) + **Party Name** (bold) + **Due Date Badge** (crisp red `Overdue · X days` pill if past due, neutral date pill otherwise).
   - **Financial Block:** Large `tabular-nums` **Net Payable** (`₹72,996.00`), sub-line showing `Gross: ₹... · TDS: NA` (or `TDS: ₹1,450.00`).
   - **Metadata Row:** Invoice Ref (`0282` / `On Account`), Purpose (`Against Bill` / `Against PI`), Payment Mode badge (`NEFT/RTGS` or `Cheque`), optional Remarks box.
   - **Source Bank Pill:** Displays assigned bank (`Axis`, `SIB`, `HDFC`, `Kotak`); Owner can switch bank inline before approving.
   - **Audit Trail Sub-line:** `Prepared by Shahnaz (10:15 AM) · Verified by Favas (10:42 AM)`.
   - **Optional Document Button:** Shows `View Bill` button ONLY if an optional Supplier Invoice was uploaded.
   - **Action Row (Thumb-Friendly):** **Approve** (Primary/Emerald), **Hold** (Outline/Amber), **Reject** (Outline/Rose → opens clean modal requiring mandatory `rejection_reason`).
   - **Zero Direct Financial Editing:** No Edit button for Amount, TDS, or Vendor on Approver screens.

---

### 3.3 Verifier Queue (`/verify` — Senior Accountant View)
- High-clarity desktop table (card fallback on mobile) listing `PENDING_VERIFICATION` entries for the active company.
- **Columns:** Due Date (with Overdue badge), Party Name & Beneficiary Details *(shows `Beneficiary Name · A/C · IFSC` underneath so Verifier can spot bank-detail mismatches immediately)*, Invoice Ref & Purpose, Gross / TDS / Net Payable, Source Bank, Submitted Timestamp, Actions.
- **Actions per Row:**
  - **Verify & Forward** (1-click optimistic transition to `PENDING_APPROVAL`, notifies Approver).
  - **Return / Reject** (opens modal with mandatory note, returns item to `PREPARER`).
  - Optional `View Bill` link if invoice attached.

---

### 3.4 Preparer Workspace (`/payments` — Desktop-First Accounts View)
1. **Top Action & Bank Balance Bar:**
   - Displays compact pills for each active bank's current `Available Balance` + an **Update Balances** button (opens a quick modal to enter fresh opening/current bank balances before submitting a batch).
   - Primary buttons: **`+ New Entry`**, **`Print Voucher (/print)`**.
2. **Status Tabs (with Live Counts):**
   - `Draft` · `Pending Verification` · `Pending Approval` *(shows `ON_HOLD` amber badge clearly)* · **`Ready to Pay (Pending UTR)`** · `Paid` · `Rejected`
3. **Clean Desktop Table (7 Columns):**
   1. Due Date / Sheet Date
   2. Party Name *(+ Payment Type/Mode micro-tag)*
   3. Invoice / Ref & Purpose
   4. Gross & TDS (`NA` if 0)
   5. Net Payable (`tabular-nums`, bold)
   6. Source Bank & Status Badge
   7. Actions
4. **Create / Edit Payment Sheet (`payment-form-sheet.tsx`):**
   - Slide-over drawer from right.
   - Fields:
     - **Vendor (`party_name` searchable select):** Selecting a vendor displays a subtle read-only verification strip (`Beneficiary: Manoj · A/C: XXXX · IFSC: UTIB...`).
     - **Payment Type:** Toggle (`Against Bill` vs `On Account`).
     - **Payment Mode:** Toggle (`NEFT / RTGS` vs `Cheque`).
     - **Invoice / Ref No:** Shows live inline warning banner if a duplicate `(company, vendor, invoice_ref)` exists.
     - **Due Date**, **Purpose**, **Source Bank** (active banks of current company; defaults to primary bank e.g. `Axis`).
     - **Amount (₹)** & **TDS (₹)** (defaults to `0`) → live read-only **Net Payable** readout.
     - **Remarks** (optional).
     - **Supplier Invoice Upload:** Clearly labeled **(Optional)** — PDF/Image up to 5 MB.
   - Footer: `Save as Draft` and `Save & Submit for Verification`.
5. **Ready to Pay (`Pending UTR`) Tab — Execution & Bulk Excel:**
   - Top toolbar shows **Export Bank Bulk Excel (`.xlsx`)** button:
     - Clicking opens a clean preview modal grouping selected/all `APPROVED` items for the chosen bank automatically into **Same-Bank** vs **Other-Bank (NEFT/RTGS)** batches using vendor IFSC prefixes, with 1-click download for each template file (starting with Axis Bank's 2 templates).
   - Per-row **Mark Paid** button opens `mark-paid-modal.tsx`:
     - Displays locked Party Name, Approved Bank, and Net Payable.
     - If `NEFT_RTGS`: Mandatory unique **UTR / Payment Ref No** + mandatory **Bank Acknowledgement PDF / Receipt** upload.
     - If `CHEQUE`: Mandatory **Cheque Number** + **Cheque Date** + optional/recommended Receipt/Cheque copy upload.
     - Clean inline validation if a duplicate UTR is entered.

---

### 3.5 Accounts-Only Monthly Reminders (`/reminders` — `PREPARER` Only)
- Lightweight, clutter-free checklist for recurring monthly dues (e.g., `KSEB G1 Electricity Bill`, `Staff Salary`).
- Displays: Title, Due Day of Month (e.g., `Every 15th`), Estimated Amount, Status for current month (`Pending` / `Done`), and quick `+ Create Payment Entry` shortcut that pre-fills the payment form.
- Completely hidden from `VERIFIER`, `APPROVER`, and `AUDITOR`.

---

### 3.6 Auditor Workspace (`/audit` — Side-by-Side Verification)
- Strictly **read-only** financial interface (zero New Entry, Edit, Delete, or Export-to-Bank buttons).
- **Filters:** Date Range (quick presets: `Last 7 Days`, `This Month`, Custom Range), Audit Status (`Unaudited` default · `Audited` · `All`), Vendor Search, Bank.
- **Side-by-Side Audit Drawer:**
  - Clicking any `PAID` row opens a wide two-column review drawer (stacked tabs on mobile):
    - **Left Column — Digital Payment Voucher:** Party Name, Beneficiary Name, Account/IFSC, Invoice Ref, Due Date, Gross/TDS/Net, Source Bank, UTR or Cheque No/Date, and full **Audit Timeline** (`Prepared by ...`, `Verified by ...`, `Approved by ...`, `Paid by ...` with exact timestamps).
    - **Right Column — Bank Acknowledgement Proof:** Embedded PDF/Image viewer loaded via private signed URL (with "Open in New Tab" fallback) so the Auditor can visually match Amount & UTR side-by-side.
  - **Bottom Action Bar:** Single prominent **`Mark Audited`** button. Once confirmed, replaces button with an immutable Emerald badge: `Audited by [Auditor Name] on [Date & Time]`.

---

### 3.7 Vendor Directory (`/vendors`)
- Search bar (searches `party_name`, `beneficiary_name`, `account_number`, `ifsc_code`).
- Lean table columns: **Party Name**, **Beneficiary Name (Bank A/C)**, **Account Number**, **IFSC Code** *(with auto-detected bank chip like `AXIS`, `SIB`, `HDFC`, `KOTAK`)*, **Status**, **Action**.
- Add / Edit Modal has strictly 5 fields: `Party Name *`, `Beneficiary Name *`, `Account Number *`, `IFSC Code *`, `Remarks (Optional)`. **No GSTIN or Mobile Number fields.**

---

### 3.8 History & Printable PDF Voucher (`/history`, `/print`)
- **`/history`:** Clean archive table scoped to the active company. Filters: Search (Vendor, Invoice, Purpose, UTR/Cheque), Status, Bank, Audit Status, Date Range. Displays filtered Net Total + **Print / Save PDF Voucher** button + CSV Export. Clicking any row opens a clean detail drawer showing full timestamps, Bank Acknowledgement PDF, optional Invoice, and Audit badge.
- **`/print`:** Dedicated A4 `@media print` sheet matching the company's formal Payment Approval Form layout — header displays active Company Name (`INDFURN` or `VINMORE`), date range, full line-item table (`SL No`, `Vendor/Supplier`, `Invoice/Ref`, `Due Date`, `Purpose`, `Amount`, `TDS`, `UTR/Cheque Ref`, `Bank/Remarks`), grand total, and digital timestamped sign-off footer (`Prepared By`, `Verified By`, `Approved By`, `Audited By`). Includes a 1-click **Print / Save as PDF** button hidden during printing.

---

### 3.9 Admin Settings (`/settings` — `is_admin` Only)
Two clean tabs:
1. **Team Users Tab:**
   - Lists all users with Name, Email, Role badge, Admin badge, Assigned Companies (`INDFURN`, `VINMORE`, or `Both`), Active/Disabled pill, and Edit / Disable actions (self-disable blocked).
   - **Create / Edit User Modal:** Full Name, Email, Password *(create only)*, Role selector (`PREPARER`, `VERIFIER`, `APPROVER`, `AUDITOR`), `Admin Access` toggle, and **Company Access Checkboxes** (`[ ] INDFURN`, `[ ] VINMORE` — at least one required).
2. **Company Banks Tab (Scoped to Active Company):**
   - Lists banks for the currently selected company (`INDFURN` or `VINMORE`) with Bank Name, Short Code, IFSC Prefix, Masked Account No, Primary indicator, Current Balance, Active toggle, and Edit modal.

---

## 4. Interaction States & Performance UX
- **Instant Route Transitions:** `src/app/(dashboard)/loading.tsx` renders a clean `#F8FAFC` skeleton matching the 4-card strip and table rows so tab navigation feels immediate (0ms perceived freeze).
- **Optimistic UI:** `Verify`, `Approve`, `Bulk Approve`, `Hold`, `Reject`, and `Mark Audited` update local state immediately with rollback + clear `sonner` error toast if a server check fails.
- **Empty States:** Every empty tab shows a crisp, helpful single-line message (e.g., *"All caught up — no payments waiting for your approval"*).
- **No Raw Database Errors:** All PostgreSQL/RLS/unique-constraint errors are mapped to plain, friendly messages (e.g., *"This UTR number is already recorded for Invoice #0282"*).