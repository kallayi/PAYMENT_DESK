# 01 — Project Overview: INDFURN Payment Approval & UTR Tracking System

## 1. Executive Summary
This project digitizes the manual **Payment Approval Form** and post-payment bank reconciliation process for **INDFURN** (a B2B furniture business).

Currently, the workflow relies on printed paper approval sheets, handwritten UTR numbers, and stapled bank transaction printouts from **Axis Bank (Neo for Corporates)** and **South Indian Bank (SIB)**. The goal is to replace this paper process with a **clean, fast, minimal Progressive Web App (PWA)** that works seamlessly on both desktop (for office staff/accountant) and mobile (for the owner).

**Core Design Philosophy:** Simplicity first. Zero clutter, minimal clicks, strict financial accuracy, and complete auditability.

---

## 2. User Roles & Responsibilities

The system has exactly **3 roles** for MVP. The Owner also holds Admin privileges (managing users, vendors, and company bank accounts).

| Role | Title in Form | Primary Device | Core Responsibilities |
| :--- | :--- | :--- | :--- |
| **`STAFF`** | Stock / Purchase Staff | Mobile / Desktop | Monitors stock, places supplier orders, and uploads incoming Supplier Invoices / Proforma Invoices (PI) with basic details to notify the Accountant. |
| **`ACCOUNTANT`** | Prepared By | Desktop (Primary) | Reviews staff-uploaded invoices (or creates direct expense/transfer entries), prepares daily payment requests/batches, submits to Owner for approval, executes approved payments on Axis/SIB bank portals, and enters the UTR number + uploads the bank receipt to mark as `PAID`. |
| **`OWNER`** | Approved / Recommended By | Mobile (Primary) & Desktop | Reviews pending payment items, views attached invoices, optionally switches the source bank account (`Axis` ↔ `SIB`), and performs **Approve**, **Hold**, or **Reject** (with reason) on each individual item. |

---

## 3. End-to-End Business Workflow

### Step 1: Stock Order & Invoice Upload (`STAFF`)
1. When stock runs low, Staff orders directly from the vendor/company.
2. Once the vendor sends an Invoice or Proforma Invoice (PI), Staff opens the app and uploads the bill (photo/PDF) along with Vendor Name, Invoice/Ref No, and Amount (optional if unclear on bill).
3. The uploaded bill appears in the Accountant's **"Incoming Bills"** queue.
   *(Note: Accountant can also create payment entries directly without a Staff upload—for recurring bills like KSEB electricity, internal bank transfers, or on-account payments.)*

### Step 2: Payment Request Preparation (`ACCOUNTANT`)
1. Accountant selects an incoming bill (or clicks "New Entry") and fills in all required payment fields:
   - Vendor / Supplier (from master list or quick-add)
   - Invoice / Ref No
   - Due Date
   - Purpose
   - Amount (₹) & TDS (₹)
   - Proposed Source Bank (`Axis Bank` or `South Indian Bank`)
   - Remarks (optional)
2. Entries are grouped by date into a **Daily Payment Sheet / Batch** (mirroring the physical form), or submitted individually.
3. Accountant submits the items -> Status changes to `PENDING_APPROVAL`.

### Step 3: Owner Review & Approval (`OWNER`)
1. Owner views all `PENDING_APPROVAL` items grouped clearly by date/batch, showing **Total Pending Amount** and **Bank-wise totals** (Axis vs. SIB).
2. Owner taps an item to inspect the attached invoice image/PDF.
3. **Line-Item Decisions:** Even when items are grouped in a daily sheet, the Owner approves, holds, or rejects **each line item individually** (never forced all-or-nothing).
4. **Bank Override:** Before approving, the Owner can switch the source bank (e.g., changing `Axis` to `SIB`), which is recorded in the audit log.
5. Owner clicks:
   - **Approve** -> Status becomes `APPROVED` (Core financial fields are immediately locked).
   - **Hold** -> Status becomes `ON_HOLD` (Paused for later review).
   - **Reject** -> Mandatory rejection reason -> Status becomes `REJECTED`.

### Step 4: Payment Execution & UTR Reconciliation (`ACCOUNTANT`)
1. Approved items appear in the Accountant's **"Ready to Pay"** list.
2. Accountant logs into the respective corporate banking portal (**Axis Bank Neo** or **South Indian Bank**) and completes the NEFT / RTGS / Transfer externally.
3. Accountant returns to the app, opens the `APPROVED` item, enters the **UTR / Payment Ref No**, and uploads the **Bank Transaction Receipt** (PDF/Image).
4. Status changes to `PAID`. The record is now finalized, locked, and searchable forever.

---

## 4. Payment Item State Machine

```text
[STAFF Upload (Optional)]
          │
          ▼
       (DRAFT) ──► Accountant edits / deletes draft
          │
          ▼  [Submit to Owner]
  (PENDING_APPROVAL) ◄──────────────┐
      │     │     │                 │
      │     │     └──► (ON_HOLD) ───┘ [Owner resumes]
      │     │
      │     └────────► (REJECTED) [End state; Accountant may clone as new entry]
      │
      ▼  [Owner Approves -> AMOUNT, VENDOR, INVOICE LOCKED]
   (APPROVED)
      │
      ▼  [Accountant enters Unique UTR + Uploads Bank Receipt]
     (PAID) [Final immutable state]
(Any non-paid item can also be moved to CANCELLED via soft-cancel; hard deletion of submitted financial records is strictly prohibited.)5. Core Data Fields (Mapped from Physical Form)Every payment line item captures the exact information used on INDFURN's physical Payment Approval Form plus digital tracking fields:FieldType / FormatRequired?Notes / ExamplesSerial / Entry NoAuto-generatedYesSequential per daily sheet / global IDDateYYYY-MM-DDYesApproval sheet / request dateVendor / SupplierFK (vendors)Yese.g., VINMORE, Ariham Industries, INDFURN (Axis), KSEBInvoice / Ref NoTextYesBill/PI number (0282), On Account, NA, or period (Sep-Oct)Due DateYYYY-MM-DDYesPayment due datePurposePreset + Custom TextYesPresets: Against Bill, Against PI, Transfer, Electricity Charge, Advance, OtherAmount (₹)NUMERIC(12,2)YesGross amount in INR (e.g., 50,000.00). Must be > 0.TDS (₹)NUMERIC(12,2)NoDefault 0.00 (displayed as NA on print form if 0)Net Payable (₹)Computed (Amount - TDS)AutoActual amount transferred from bankSource BankFK (company_banks)YesDefault company accounts: Axis Bank, South Indian Bank (SIB)Payment Ref No (UTR)Text (UNIQUE)On PAIDEntered post-payment (e.g., 997461727, AXCOH32315623899, SIBLN26323391368)RemarksTextNoAdditional notes / bank switch notesInvoice FilePrivate Storage PathOptional*Supplier bill / PI photo or PDF (*recommended for vendor bills)Bank Receipt FilePrivate Storage PathOn PAIDAxis Neo Transaction Analysis Report or SIB Transaction Details PDF/ImageSign-off MetadataUser IDs + TimestampsAutocreated_by (Prepared By), approved_by & approved_at (Approved By), paid_by & paid_at6. Critical Business & Integrity RulesPost-Approval Immutability: Once an item reaches APPROVED, nobody (including Accountant) can edit Vendor, Invoice No, Amount, or TDS. Only UTR / Payment Ref No, Bank Receipt, Paid Date, and post-payment Remarks can be added.No Hard Deletes: Once submitted (PENDING_APPROVAL or later), records can never be permanently deleted from the database. Use CANCELLED status with a reason.Unique UTR Enforcement: The system must block saving a UTR / Payment Ref No that already exists on another payment record (prevents accidental double-mapping).Duplicate Invoice Warning: If the Accountant enters the same Vendor + Invoice/Ref No that already exists (ignoring generic strings like NA and On Account), show a clear warning banner before allowing submission.Owner Bank Override: If the Owner changes the Source Bank during approval (e.g., Axis -> SIB), save the updated bank and automatically log the previous and new values in audit_logs.Audit-Ready Printing: Any date's payment entries must be exportable/printable as a clean PDF replicating INDFURN's Payment Approval Form layout (with Prepared By, Approved By, timestamps, Totals, and UTR numbers).7. Project Scope: MVP (v1) vs. Out of Scope (v2)Important for AI Coding Agent: Build ONLY the MVP (v1) features below. Do NOT invent extra widgets, charts, or modules from the v2 list.In Scope — MVP (v1)Secure Email/Password authentication with strict role routing (STAFF, ACCOUNTANT, OWNER).Staff mobile-friendly screen to upload supplier bills/invoices.Accountant workspace to create/edit draft entries, group by date, submit for approval, and enter UTR + Bank Receipt for approved items.Owner mobile-first approval screen with card view, bank-wise totals, inline invoice viewer, bank switcher, and Approve / Hold / Reject actions.Vendor Master & Company Bank Master management (with quick inline vendor add).Search & History page (filter by Vendor, Date Range, Status, Bank, or UTR number).Printable INDFURN Payment Approval Form (PDF/Print view) + CSV export.Automatic Audit Trail logging all status changes, approvals, and edits.PWA setup (manifest.json, icons, installable on Android/iOS/Desktop).Out of Scope — Do NOT Build in v1 (Planned for v2)Direct Bank API integration / automated bank transfers.Automatic OCR / PDF text extraction from Axis Neo or SIB receipts.Inventory / Stock quantity management module.Tally ERP or GST portal integration.WhatsApp / SMS paid notification gateways (in-app / web push only if needed later).Complex BI dashboards, multi-chart analytics, or multi-branch accounting.