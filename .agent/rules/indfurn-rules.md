# Antigravity Coding Agent Rules — INDFURN PayFlow

Follow these rules strictly on every single prompt and file edit.

## 1. Scope & Planning Discipline
- **Read docs first:** Before coding any feature, reference `docs/01_PROJECT_OVERVIEW.md`, `docs/02_UI_UX_DESIGN.md`, `docs/03_DATABASE_SECURITY.md`, and `docs/04_TECH_ARCHITECTURE.md`.
- **One Phase at a Time:** Build ONLY the phase or task explicitly requested by the user. Never jump ahead or invent v2 features (no charts, no bank APIs, no OCR, no notifications gateway, no inventory module).
- **No Unrequested Refactors:** Do not rewrite working files outside the current task scope.

## 2. Strict Minimal UI Rules (Anti-Clutter)
- **Light Mode Only:** Clean `#F8FAFC` page canvas, `#FFFFFF` cards, `#E2E8F0` 1px borders.
- **Zero Charts/Bloat:** Never add charts, sparklines, decorative gradients, or 4+ KPI boxes.
- **No Live Role Switcher:** Never put a fake role-switching dropdown in the header. Roles come strictly from authenticated `profiles.role`.
- **Mobile-First for Owner & Staff:**
  - Every interactive button/input on mobile MUST have `min-h-[44px]`.
  - No wide horizontal tables on mobile (`< 768px`)—render stacked clean cards instead.
- **Numbers & Indian Currency:**
  - Always format currency via `formatINR()` (`en-IN` locale, e.g., `₹50,000.00`).
  - Always add `tabular-nums` class to amounts, dates, totals, and UTR codes.
- **Component Cleanliness:** Use `shadcn/ui` primitives + Tailwind CSS. Keep individual component files concise and focused (ideally under 250 lines).

## 3. Financial & Security Non-Negotiables
- **Server Auth Check:** On the server, ALWAYS use `supabase.auth.getUser()`—never trust `getSession()` alone.
- **Role Enforcement:** Enforce role checks in Middleware, Server Actions, AND PostgreSQL RLS. Never rely on hiding UI buttons as security.
- **Post-Approval Lock:** Never allow editing `vendor_id`, `invoice_ref`, `amount`, `tds`, or `purpose` once status is `APPROVED` or `PAID`.
- **No Hard Deletes:** Never delete submitted `payment_items` (`status !== 'DRAFT'`). Always use `CANCELLED` status.
- **Private Storage Only:** NEVER use `getPublicUrl()` for `supplier-invoices` or `bank-receipts`. Always request short-lived Signed URLs via server actions.
- **Protect Secret Keys:** Never import `src/lib/supabase/admin.ts` or reference `SUPABASE_SERVICE_ROLE_KEY` in any Client Component (`'use client'`).
- **Safe Math:** Avoid floating-point drift on currency displays; round strictly to 2 decimal places (`Math.round(val * 100) / 100`) and store as `NUMERIC(12,2)` in Postgres.

## 4. TypeScript & Code Quality
- **Strict TypeScript:** Never use `any`. Define clean interfaces in `src/types/database.ts`.
- **Validate Every Mutation:** Every Server Action MUST validate inputs with Zod (`src/lib/validators.ts`) and return `{ success: true, data }` or `{ success: false, error }`.
- **Graceful Errors & Loading States:** Every button that triggers a Server Action MUST show a loading spinner/disabled state to prevent double submissions (critical for double-approval or double-entry prevention). Show clear toast feedback via `sonner`.
- **Verify Before Finishing:** After completing a phase, check for TypeScript errors (`npx tsc --noEmit`) and verify no broken imports exist.