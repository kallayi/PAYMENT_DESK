# Payment Desk — Project Overview (v2)

## 1. Executive Summary
**Payment Desk** is an internal, mobile-first Progressive Web App (PWA) built to digitize and streamline the daily vendor payment approval, bank bulk execution, UTR tracking, and post-payment audit workflow for **INDFURN** and **VINMORE**.

It replaces manual paper payment approval forms and repetitive single-entry typing on corporate bank portals with a structured, tamper-proof digital pipeline — from bill preparation and verification to live cash-balance-aware Owner approval, bank bulk Excel export, UTR/receipt archival, and independent audit sign-off.

---

## 2. Scope: Multi-Company & Banking Structure
The system supports strictly **two companies** with complete data isolation (`company_id` enforced across all operational tables and RLS policies):

| Company | Configured Banks | Notes |
| :--- | :--- | :--- |
| **INDFURN** | Axis Bank *(Primary Vendor Execution)*, South Indian Bank (SIB), HDFC Bank, Kotak Mahindra Bank | Internal inter-account transfers (e.g., SIB → Axis main account) do not require approval workflow tracking. |
| **VINMORE** | Axis Bank, HDFC Bank, Kotak Mahindra Bank | Does not use SIB; follows the exact same payment workflow as INDFURN. |

- **Company Switcher:** Users with access to both companies switch cleanly via a top workspace switcher (`INDFURN` ↔ `VINMORE`). Single-company users are locked to their assigned company.
- **Standalone Branding:** Branded as **`Payment Desk`** with a dedicated app icon and clean Maroon/Black light theme (not tied to a single company's logo).
- **Access Control:** Private internal portal with no public sign-up. All accounts are provisioned by an Admin.

---

## 3. Roles & Responsibilities (RBAC)
The previous 2-role (`OWNER`/`ACCOUNTANT`), `STAFF` (`/bills`), and Partner (`Recommended By`) workflows are deprecated. **Payment Desk v2** uses **4 Operational Roles** plus an **`is_admin`** capability flag. Multiple users can be assigned to any role, and each user is granted access to `INDFURN`, `VINMORE`, or `Both`.

| Role | Primary Operator | Core Responsibilities & Permissions |
| :--- | :--- | :--- |
| **Admin** (`is_admin = true`) | Owner / Developer | Creates, edits, enables, and disables team users; assigns roles and company access (`INDFURN` / `VINMORE` / `Both`); manages company bank accounts. |
| **Preparer / Executor** (`PREPARER`) | Accounts Executive | Creates, edits, and submits draft payment entries; maintains the Vendor Master; updates current **Available Bank Balances**; exports **Bank Bulk Upload Excel** for approved payments; records unique **UTR** (or **Cheque No + Date**) and uploads **Bank Acknowledgement PDF** to mark entries `PAID`; tracks Accounts-only **Monthly Reminders** (KSEB, Staff Salary). |
| **Verifier** (`VERIFIER`) | Senior Accountant | Reviews `PENDING_VERIFICATION` entries for amount, TDS, due date, and vendor beneficiary accuracy; either **Verifies** (forwards to Approver) or **Returns / Rejects** with a mandatory note back to Preparer. |
| **Approver** (`APPROVER`) | Owner (Final Authority) | Reviews verified payments (`PENDING_APPROVAL` and `ON_HOLD`); monitors **Available Balance vs. Projected Remaining Balance**; prioritizes bills by Due Date and Vendor Search; performs **Individual Approve**, **Bulk Approve**, **Hold**, or **Reject** (with mandatory reason). Never edits financial fields directly — any revision is sent back to Preparer. Has override authority to approve even if a Verifier is unavailable. Every payment requires Owner approval (no auto-approval limit). |
| **Auditor** (`AUDITOR`) | Internal / External Auditor | Strictly **read-only** for financial data (no data entry or edits). Reviews `PAID` history alongside the digital Payment Voucher and uploaded **Bank Acknowledgement PDF**, then clicks **`Mark Audited`** to stamp an immutable audit verification. |

---

## 4. End-to-End Business Workflow

### Lifecycle Pipeline
`DRAFT` → `PENDING_VERIFICATION` → `PENDING_APPROVAL` → `APPROVED` *(Ready to Pay / Pending UTR)* → `PAID` *(Completed)* → `Audited`

*(Exception states: `ON_HOLD`, `REJECTED`, `CANCELLED`)*

### Step-by-Step Operational Flow
1. **Bank Balance Update & Bill Preparation (`PREPARER`):**
   - Updates current **Available Balance** per company bank before preparing a batch.
   - Creates payment entries for either **Exact Bill-by-Bill** settlements (`Against Bill`, `Against PI`, `Electricity Charge`, etc.) or **On-Account / Running Balance** lump sums (e.g., ₹50,000 / ₹1,00,000).
   - Selects payment mode: **NEFT/RTGS** (default) or **Cheque** (for rare one-time parties). Cash and UPI are out of scope.
   - `Net Payable = Amount - TDS` is calculated automatically (`TDS` displays `NA` when `0`).
   - Attaching a Supplier Invoice is **optional**. Submits entries to `PENDING_VERIFICATION`.
2. **Verification (`VERIFIER`):**
   - Receives notification of newly submitted entries.
   - Cross-checks bill details and beneficiary info, then **Verifies** (`PENDING_APPROVAL`) or **Returns/Rejects** with a reason.
3. **Owner Decision & Cash Visibility (`APPROVER`):**
   - Receives notification of verified entries.
   - Dashboard shows 4 key live metrics for the active company:
     1. **Total Available Balance** *(with expandable per-bank breakdown)*
     2. **Pending Verification** *(total currently with Verifier)*
     3. **Pending Approval** *(total awaiting Owner decision)*
     4. **Projected Remaining Balance** *(live calculation: `Available Balance - Approved/Selected Total`)*
   - Reviews entries using **Due Date / Overdue** indicators and **Vendor Search**.
   - Performs **Bulk Approve** (multi-select checkboxes) or line-by-line **Approve**, **Hold**, or **Reject** (mandatory reason).
   - **No Clock Time Locks:** Standard batches run around 11:00 AM and 4:00 PM, but approvals are permitted anytime (including evenings/travel). Every transition records an exact **Timestamp**.
4. **Bank Bulk Execution & UTR Settlement (`PREPARER`):**
   - Receives notification once entries are approved, held, or rejected.
   - Opens the **Ready to Pay / Pending UTR** queue and exports the **Bank Bulk Upload Excel (`.xlsx`)**.
   - System auto-separates **Same-Bank** vs. **Other-Bank (NEFT/RTGS)** rows using each vendor's **IFSC prefix** and populates `beneficiary_name`, `account_number`, `ifsc_code`, and `net_payable` automatically *(starting with Axis Bank's two bulk upload templates, extensible to SIB/HDFC/Kotak)*.
   - Uploads the Excel to the corporate bank portal (Owner authorizes via bank OTP).
   - Returns to Payment Desk, enters each payment's unique **UTR Number** (or **Cheque No + Cheque Date** for cheques), and uploads the **Bank Acknowledgement PDF**. Only then does the item move from `Pending UTR` to `PAID`.
5. **Audit & Archival (`AUDITOR`, `APPROVER`, `PREPARER`):**
   - **Pending UTR Tracking:** Both Preparer and Owner overview highlight approved items still missing UTR/PDF proof.
   - **Audit Verification:** Auditor filters completed `PAID` records by date/month/vendor, compares the Payment Voucher against the Bank Acknowledgement PDF, and marks items **`Audited`**.
   - **PDF Voucher & History:** Any payment batch or entry can be searched, filtered, and saved/printed as a clean A4 PDF Voucher (`/print`).

---

## 5. Key Functional Modules
- **Smart Vendor Master (Lean):** Stores only **Party Name** (trade/display name, e.g., `Naas Hardware`), **Beneficiary Name** (bank account holder name, e.g., `Manoj`), **Account Number**, **IFSC Code**, and optional **Remarks**. GSTIN and mobile numbers are intentionally excluded.
- **Bank Bulk Upload Excel Exporter:** Replaces Tally integration (Tally export is not required). Generates bank-ready `.xlsx` files split automatically into Same-Bank and Other-Bank templates.
- **Workflow Notifications (In-App + PWA Push):**
  - `PREPARER` submits → notifies `VERIFIER`.
  - `VERIFIER` verifies → notifies `APPROVER`.
  - `APPROVER` approves / holds / rejects → notifies `PREPARER`.
  - No notification is sent when an item is marked `PAID`.
- **Accounts-Only Monthly Reminders:** Lightweight reminder tracker for recurring fixed obligations (e.g., KSEB electricity bills, staff salaries), visible exclusively to `PREPARER` / Accounts staff.
- **Financial Safeguards:**
  - Duplicate Bill Number warning per `(company, vendor, invoice_ref)`.
  - Strict unique UTR enforcement (duplicate UTRs blocked at DB & UI levels).
  - Core financial fields permanently locked once `APPROVED`.
  - Zero hard deletes on submitted/paid records (`DRAFT` only).
  - Private Supabase Storage for Bank Acknowledgement PDFs and optional Invoices.

---

## 6. Explicitly Out of Scope (v2)
- Public user self-registration / sign-up.
- Creating arbitrary new companies beyond `INDFURN` and `VINMORE`.
- Cash or UPI payment tracking.
- Tally ERP export or direct banking API integrations.
- AI/OCR automatic UTR extraction from Bank Acknowledgement PDFs.
- Decorative dashboard analytics charts or complex monthly BI reports (clean filterable History & Audit log suffices).
- Clock-based submission or approval time locks.