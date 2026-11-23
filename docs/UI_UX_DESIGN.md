# 02 — UI/UX Design Specification: INDFURN Payment Approval PWA

## 1. Core Design Philosophy (READ FIRST)
The target users are busy business staff, an accountant, and a company owner—not software engineers. **Simplicity beats density.**

- **Visual Tone:** Calm, crisp, modern light-mode financial utility (clean white cards on a subtle off-white canvas).
- **Zero Clutter:** Show only the exact information needed to take the next action. Hide secondary details inside a clean detail sheet/drawer.
- **Role-Focused Screens:** Never build one bloated "do-everything" dashboard. Each role (`OWNER`, `ACCOUNTANT`, `STAFF`) gets a dedicated, minimal workspace tailored to their device.

---

## 2. Strict Anti-Clutter Rules (DO NOT VIOLATE)
> **Critical Instructions for AI Coding Agent:**
1. **NO charts, graphs, or donut rings** anywhere in v1.
2. **NO top KPI bloat:** Maximum **1 compact summary strip** per screen (e.g., Total Pending + Axis/SIB split). Do not create 4–6 giant stat boxes above the fold.
3. **NO live role-switcher in production UI:** The logged-in user's role determines their interface automatically.
4. **NO wide horizontal-scroll tables on mobile:** All tables MUST cleanly collapse into stacked mobile cards below `768px` (`md` breakpoint).
5. **NO nested modals** (never open a modal on top of another modal).
6. **NO extra decorative icons, gradients, or animations:** Keep spacing generous (`p-4` to `p-6`, `gap-4`) and borders subtle (`1px solid #E2E8F0`).

---

## 3. Design System Tokens

### Color Palette (Light Mode Only for v1)
| Role | Hex / Tailwind | Usage |
| :--- | :--- | :--- |
| **Page Background** | `#F8FAFC` (`slate-50`) | Main app canvas |
| **Card / Surface** | `#FFFFFF` (`white`) | Cards, tables, forms, drawers |
| **Border** | `#E2E8F0` (`slate-200`) | Subtle dividers and outlines |
| **Primary Text** | `#0F172A` (`slate-900`) | Headings, Vendor names, Amounts |
| **Secondary Text** | `#64748B` (`slate-500`) | Labels, Invoice refs, Dates |
| **Primary Brand / Action** | `#1E293B` (`slate-800`) or `#2563EB` (`blue-600`) | Primary buttons, active tab |
| **Approve / Paid** | `#15803D` (`emerald-700`) on `#ECFDF5` | Positive actions & completed badge |
| **Reject / Danger** | `#B91C1C` (`rose-700`) on `#FFF1F2` | Reject action & rejected badge |
| **Pending / Warning** | `#B45309` (`amber-700`) on `#FFFBEB` | Pending approval badge & duplicate warning |
| **On Hold / Info** | `#1D4ED8` (`blue-700`) on `#EFF6FF` | On Hold badge |

### Typography & Formatting
- **Font Family:** `Inter` (loaded via `next/font/google`) with system sans fallback.
- **Numbers & Currency:** ALWAYS apply `tabular-nums` (`font-variant-numeric: tabular-nums`) on all amounts, totals, dates, and UTR numbers.
- **Indian Currency Format:** Format every Rupee value with `en-IN` locale (`₹50,000.00`, `₹3,89,597.00`).
- **Touch Targets:** All mobile buttons and inputs must have a minimum height of `44px` (`h-11`).

---

## 4. Navigation Architecture (Responsive)

### Desktop (`lg` and above)
- **Slim Left Sidebar (`w-56` / `224px`):** Company wordmark (`INDFURN`) at top, maximum 4 navigation links, user name + role + Logout at bottom.
- **Clean Content Header:** Page title on the left, 1 primary action button on the right (e.g., `+ New Payment` for Accountant).

### Mobile (`< lg`)
- **Minimal Top Header (`h-14`):** Page title on left, Logout / Profile icon on right.
- **Fixed Bottom Tab Bar (`h-16`, `safe-area-inset-bottom`):**
  - **Owner Tabs (3):** `Approvals` (with pending badge), `History`, `Settings` (Vendors/Banks/Users)
  - **Accountant Tabs (4):** `Payments`, `Incoming` (with count), `History`, `Vendors`
  - **Staff Tabs (2):** `Upload Bill`, `My Uploads`

---

## 5. Screen-by-Screen Blueprints

### Screen A: Login (`/login`)
- Centered white card (`max-w-sm`) on `#F8FAFC` background.
- `INDFURN` title + subtle subtitle (`Payment Approval Portal`).
- Email input, Password input (with show/hide toggle), full-width `Sign In` button.
- Clear inline error message on invalid login.

---

### Screen B: Owner Approval View (`/approvals`) — **MOBILE-FIRST PRIORITY**
Designed so the Owner can review and clear a day's payments in under 60 seconds with one thumb.

1. **Compact Summary Bar (Top):**
   - Left: `Pending Approval` label + Large bold Total (e.g., `₹3,89,597.00`) + item count (`4 items`).
   - Right/Below: Two small bank pills showing split: `Axis: ₹1,22,996` | `SIB: ₹2,66,601`.
2. **Date-Grouped Approval Cards:**
   - Clean date divider: `19 Nov 2026 (4 items)`.
   - Each card has **exact 4 clean rows**:
     - **Row 1:** Vendor Name (bold, `text-base`) on left | **Net Payable Amount** (bold, `text-lg`) on right (show small `TDS: ₹X` below amount only if `TDS > 0`).
     - **Row 2:** `Purpose` · `Ref: Invoice No` · `Due: 19 Nov`.
     - **Row 3:** Interactive Bank Pill (`Pay via: [Axis Bank ▾]` — lets Owner switch between `Axis Bank` and `SIB` in 1 tap before approving) + `View Bill` text button (if invoice attached).
     - **Row 4 (Action Bar):** 3 clean buttons — `Approve` (Solid Green, widest), `Hold` (Neutral outline), `Reject` (Subtle Red outline).
3. **Confirmations:**
   - **Approve:** Lightweight confirmation popover/dialog showing Vendor + Amount + Selected Bank -> `Confirm Approve`.
   - **Reject:** Small modal requiring a short `Rejection Reason` text input -> `Confirm Reject`.
   - **Hold:** Single tap moves item to `On Hold` tab with toast undo/confirmation.

---

### Screen C: Accountant Workspace (`/payments`) — **DESKTOP-FIRST PRIORITY**
Clean, distraction-free ledger for daily entry, tracking approvals, and closing UTRs.

1. **Top Action Bar:**
   - Date Filter / Batch Selector (defaults to Today / All Active) + `Print Form` button + Primary `+ New Entry` button.
2. **Single-Row Status Tabs (with live counts):**
   - `Incoming Bills` (uploaded by Staff) | `Draft` | `Pending` | `Ready to Pay` (`APPROVED`) | `Paid` | `Rejected`
3. **Clean Table (Desktop) / Compact Cards (Mobile):**
   - Maximum **7 columns** on desktop:
     1. `Date`
     2. `Vendor & Invoice Ref` (2-line cell: Vendor bold, Invoice/Ref muted below)
     3. `Purpose & Due` (2-line cell)
     4. `Amount (₹)` (Net amount right-aligned; small TDS note below if > 0)
     5. `Bank` (`Axis` / `SIB` pill)
     6. `Status / UTR` (Status badge; shows monospace UTR if Paid)
     7. `Action` (Strictly 1 primary contextual button per row: `Edit / Submit` for Draft, `Enter UTR` for Approved, `View` for Paid/Pending)
   - Bottom Footer Row of Table: Shows sum of visible items (`Total: ₹3,89,597.00`).
4. **Create / Edit Payment Entry Form (Slide-over Drawer or Dedicated Page):**
   - Clean vertical form (`max-w-xl`):
     - `Date` (defaults to today) & `Due Date`
     - `Vendor` (searchable select + `+ Quick Add Vendor` inline option)
     - `Invoice / Ref No` (triggers amber warning banner if same Vendor + Invoice already exists)
     - `Purpose` (quick preset chips: `Against Bill`, `Against PI`, `Transfer`, `Electricity Charge`, `Advance` + custom text input)
     - `Amount (₹)` & `TDS (₹)` -> displays live read-only `Net Payable (₹)`
     - `Source Bank` (`Axis Bank` / `South Indian Bank`)
     - `Invoice Attachment` (drag-drop or upload PDF/JPG/PNG, max 5MB)
     - `Remarks` (optional)
   - Bottom buttons: `Save as Draft` (outline) and `Submit for Approval` (primary).
5. **Mark Paid / Enter UTR Modal (Triggered from `Ready to Pay` tab):**
   - Read-only locked header showing: `Vendor`, `Net Payable`, `Approved Bank` (cannot be edited here).
   - Input 1: `UTR / Payment Ref No` (required; live error if duplicate UTR exists).
   - Input 2: `Bank Transaction Receipt` (PDF/Image upload, required).
   - Input 3: `Remarks` (optional).
   - Button: `Confirm Paid & Close`.

---

### Screen D: Stock Staff View (`/bills`) — **ULTRA-SIMPLE MOBILE-FIRST**
Staff should never see company bank totals, owner approvals, or payment history.

1. **Primary Card — "Upload Supplier Invoice":**
   - Large Tap-to-Upload box (`Take Photo / Choose PDF`).
   - `Vendor` (searchable dropdown or free text if new).
   - `Invoice / PI Number`.
   - `Bill Amount (₹)` (optional).
   - `Note for Accountant` (optional, e.g., "Urgent stock order").
   - Full-width `Send to Accountant` button.
2. **Below — "My Recent Uploads":**
   - Simple list of bills uploaded by staff showing Vendor, Ref No, Upload Date, and a simple status pill: `Waiting for Accountant` or `Added to Payment Queue`.

---

### Screen E: Payment Detail Drawer & File Viewer
Clicking any row/card opens a clean right-side Drawer (Desktop) or full-screen Sheet (Mobile):
- **Header:** Vendor Name, Status Badge, Net Amount.
- **Details Grid:** Invoice Ref, Date, Due Date, Purpose, Gross Amount, TDS, Source Bank, UTR (if paid), Remarks.
- **Documents Section:**
  - `Supplier Invoice` -> Inline preview for images / `Open PDF` button (via temporary Signed URL).
  - `Bank Receipt` -> Inline preview / `Open PDF` button (when paid).
- **Activity Log (Collapsible / Compact timeline at bottom):**
  - Shows clear timestamps: `Prepared by [Name]`, `Bank changed Axis -> SIB by [Owner]`, `Approved by [Owner]`, `Paid (UTR: ...) by [Accountant]`.

---

### Screen F: Search & History (`/history`)
Accessible to `OWNER` and `ACCOUNTANT`:
- Single clean filter bar: Search input (`Vendor, Invoice No, or UTR`), `Date Range`, `Status`, `Bank`.
- Clean table showing matching entries + Total Amount of filtered results.
- Actions: `Export CSV` and `Print Approval Form` (for a selected date).

---

### Screen G: Printable Payment Approval Form (`/print?date=YYYY-MM-DD`)
Must replicate INDFURN's physical paper sheet cleanly on A4 Landscape/Portrait (`@media print` & PDF):
- **Header:** Centered `Payment Approval Form`, Left: `INDFURN`, Right: `Date: DD-MM-YYYY`.
- **Bordered Table Columns (Exact Match):**
  `SL No.` | `Vendor/Supplier` | `Invoice / Ref No` | `Due Date` | `Purpose` | `Amount (₹)` | `TDS (₹)` | `Payment Ref NO` | `Remarks`
- Show `NA` in the `TDS (₹)` column when `tds == 0`.
- **Total Row:** Bold right-aligned total matching sum of amounts.
- **Footer Sign-off Row:**
  - `Prepared By:` (Accountant Name + Date/Time)
  - `Checked By:` (Optional / Blank line)
  - `Approved By:` (Owner Name + Digital Approval Timestamp)