# 01 — Project Overview: INDFURN Payment Approval & UTR Tracking System

## 1. Executive Summary
This project digitizes the manual **Payment Approval Form** and post-payment bank reconciliation process for **INDFURN** (a B2B furniture business).

Currently, the workflow relies on printed paper approval sheets, handwritten UTR numbers, and stapled bank transaction printouts from **Axis Bank (Neo for Corporates)** and **South Indian Bank (SIB)**. The goal is to replace this paper process with a **clean, fast, minimal Progressive Web App (PWA)** that works seamlessly on both desktop (for accountant) and mobile (for the owner).

**Core Design Philosophy:** Simplicity first. Zero clutter, minimal clicks, strict financial accuracy, and complete auditability.

---

## 2. User Roles & Responsibilities

The system is streamlined to strictly **2 roles**: `OWNER` (Admin) and `ACCOUNTANT`.

| Role | Title in Form | Primary Device | Core Responsibilities |
| :--- | :--- | :--- | :--- |
| **`ACCOUNTANT`** | Prepared By | Desktop (Primary) & Mobile | Prepares payment entries with invoice attachments and TDS calculations, submits items to Owner for approval, executes approved payments on Axis/SIB bank portals, enters the unique UTR number, and uploads the bank transaction receipt to mark as `PAID`. |
| **`OWNER`** | Approved / Admin | Mobile (Primary) & Desktop | Reviews pending payment requests, views attached supplier invoices, optionally switches the source bank account (`Axis` ↔ `SIB`), and performs **Approve**, **Hold**, or **Reject** (with reason). Manages company bank accounts and user provisioning. |

---

## 3. End-to-End Business Workflow

### Step 1: Payment Request Preparation (`ACCOUNTANT`)
1. Accountant opens the Payments Workspace and clicks "New Entry".
2. Fills in all required payment parameters:
   - Vendor / Supplier (from searchable master list or quick inline add)
   - Invoice / Ref No (with live duplicate invoice detection)
   - Due Date
   - Purpose (presets: Against Bill, Against PI, Transfer, Electricity Charge, Advance, Other)
   - Amount (₹) & TDS (₹) (live computed Net Payable)
   - Proposed Source Bank (`Axis Bank` or `South Indian Bank`)
   - Invoice / PI attachment (PDF or Image to private storage)
   - Remarks (optional)
3. Accountant saves as `DRAFT` or submits directly -> Status changes to `PENDING_APPROVAL`.

### Step 2: Owner Review & Approval (`OWNER`)
1. Owner opens `/approvals` on mobile or desktop.
2. Views top summary strip showing **Total Pending Amount** and **Bank split** (Axis vs. SIB).
3. Taps any payment card to inspect the full breakdown and 5-minute signed invoice preview.
4. **Bank Override:** Before approving, Owner can 1-tap switch the source bank (e.g., `Axis` ↔ `SIB`), which is logged in the audit trail.
5. Owner makes individual decisions:
   - **Approve** -> Status becomes `APPROVED` (financial parameters are locked).
   - **Hold** -> Status becomes `ON_HOLD` (paused for inquiry).
   - **Reject** -> Mandatory reason dialog -> Status becomes `REJECTED`.

### Step 3: Payment Execution & UTR Reconciliation (`ACCOUNTANT`)
1. Approved items immediately appear in the Accountant's **"Ready to Pay"** list.
2. Accountant executes the transfer on Axis Bank or South Indian Bank portal.
3. Accountant clicks **Mark Paid**, enters the **UTR / Payment Ref No**, and uploads the **Bank Transaction Receipt** (PDF/Image).
4. Status changes to `PAID`. The record is permanently locked, verified, and searchable forever in `/history`.

---

## 4. Payment Item State Machine

```text
       (DRAFT) ──► Accountant edits / deletes draft
          │
          ▼  [Submit to Owner]
  (PENDING_APPROVAL) ◄──────────────┐
      │     │     │                 │
      │     │     └──► (ON_HOLD) ───┘ [Owner resumes]
      │     │
      │     └────────► (REJECTED) [End state; Accountant may re-create]
      │
      ▼  [Owner Approves -> AMOUNT, VENDOR, INVOICE LOCKED]
   (APPROVED)
      │
      ▼  [Accountant enters Unique UTR + Uploads Bank Receipt]
     (PAID) [Final immutable state]
```

---

## 5. Core Data Fields

| Field | Type / Format | Required? | Notes / Examples |
|---|---|---|---|
| **Date** | `YYYY-MM-DD` | Yes | Approval sheet date |
| **Vendor / Supplier** | FK (`vendors`) | Yes | e.g., VINMORE, Ariham Industries, KSEB |
| **Invoice / Ref No** | Text | Yes | Bill/PI number, On Account, NA |
| **Due Date** | `YYYY-MM-DD` | Yes | Payment due date |
| **Purpose** | Preset + Text | Yes | Against Bill, Against PI, Transfer, etc. |
| **Amount (₹)** | `NUMERIC(12,2)` | Yes | Gross amount in INR (> 0) |
| **TDS (₹)** | `NUMERIC(12,2)` | No | Default 0.00 (`NA` on print form if 0) |
| **Net Payable (₹)** | Computed | Auto | Amount - TDS |
| **Source Bank** | FK (`company_banks`) | Yes | Axis Bank or South Indian Bank (SIB) |
| **Payment Ref No (UTR)** | Text (UNIQUE) | On `PAID` | Unique transaction reference |
| **Remarks** | Text | No | Additional notes |
| **Invoice File** | Storage Path | Optional | Supplier bill/PI photo or PDF |
| **Bank Receipt File** | Storage Path | On `PAID` | Bank transaction advice PDF/Image |
| **Sign-off Metadata** | User IDs + Times | Auto | `created_by`, `approved_by`, `paid_by` |
