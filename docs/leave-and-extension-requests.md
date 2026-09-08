# Leave/Break & Project Extension Requests

**Status:** Implemented in app and database (`member_requests`). This file started as a design note; for current dashboard behavior see **[DASHBOARD_FUNCTIONS.md](./DASHBOARD_FUNCTIONS.md)** and **[COPILOT_CONTEXT.md](./COPILOT_CONTEXT.md)**.

---

## Overview (behavior)

- **Leave/break:** Member submits time off with a reason and optional start/end dates; execs approve or decline.
- **Project extension:** Member submits an extension with reason and optional project name / date; execs approve or decline.
- **Calendar (related UI):** The Leave dashboard section also surfaces a **unified calendar** (birthdays, org events, team deadlines) implemented separately from `member_requests` — see `WORK_SUMMARY.txt` §0 and leave calendar components.

Roughly the same review pattern as other member-submitted items: submit → exec review → approve or decline (optional exec notes).

---

## Data model

**Option A – Single table (recommended)**  
One table for both types; use a `type` field so the schema stays simple and the dashboard can show one “Requests” section with filters.

**Table: `member_requests`**

| Column         | Type        | Notes |
|----------------|-------------|--------|
| `request_id`   | UUID        | PK, default `gen_random_uuid()` |
| `member_id`    | UUID        | FK → `members(member_id)`, NOT NULL |
| `type`         | TEXT        | `'leave'` or `'extension'`, NOT NULL |
| `reason`       | TEXT        | Member’s reason, NOT NULL |
| **Leave-only** |             | |
| `leave_start`  | DATE        | Optional |
| `leave_end`    | DATE        | Optional |
| **Extension-only** |         | |
| `project_name`| TEXT        | Optional; project they’re extending |
| `requested_by` | DATE        | Optional; date they want extended to |
| **Review**     |             | |
| `status`       | TEXT        | `'pending'` \| `'approved'` \| `'declined'`, default `'pending'` |
| `reviewed_by`  | UUID        | FK → `members(member_id)`, nullable |
| `reviewed_at`  | TIMESTAMPTZ | nullable |
| `review_notes` | TEXT        | Exec comment (e.g. why declined) |
| `created_at`   | TIMESTAMPTZ | default NOW() |

- **Option B – Two tables**  
  `leave_requests` and `extension_requests` with separate tables. More tables, but each schema is minimal. Dashboard would have two sections or two accordions.

Recommendation: **Option A** for one “Requests” area and simpler migrations/RLS.

---

## RLS (same idea as HR reports / volunteers)

- **INSERT:** Authenticated user can insert only if `member_id` is their own (match via `members.user_id = auth.uid()`).
- **SELECT:**  
  - Members: only rows where `member_id` = their own.  
  - Execs: all rows (e.g. using `has_registration_permission()` or the same “exec” check used for HR reports).
- **UPDATE:** Only execs; allow updating `status`, `reviewed_by`, `reviewed_at`, `review_notes`.

No DELETE needed (or restrict to execs if you want to support “cancel” later).

---

## Data loading and reviewer display

- **Backend:** `member_requests` has `reviewed_by`, `reviewed_at`, `review_notes`. The app sets them when an exec approves or declines.
- **Member list:** `loadMyRequests` and `loadAllMemberRequests` load the reviewer and attach **`reviewed_by_member`** (e.g. `first_name`, `last_name`) for display in the Request View modal.
- **View-as:** The **view-member-dashboard** Edge Function enriches `leave_requests` with `reviewed_by_member` so “view as” also shows who reviewed each request.

---

## Dashboard UI

**Section placement:** Leave & Extension Requests sits **right under “Your Info”** on the dashboard (member and exec views). Full section order for members vs execs is in **DASHBOARD_FUNCTIONS.md**.

**Member view (e.g. “My requests”)**

- **Submit:** Toggle or tabs: “Request leave” vs “Request extension”. Leave: reason (required), optional start/end date. Extension: reason (required), optional project name, optional “requested by” date. Submit → insert into `member_requests` with `status = 'pending'`.
- **List:** Table of current user’s requests. Columns: Type, Reason, Details, Status, Submitted, **Actions (View)**. No “Reviewed by” or “Review notes” in the table — that info is only in the **Request View** modal.
- **View button:** Every request has a **View** button. Opens the **Request View** modal.

**Exec view (“Leave & extension requests”)**

- **Filters:** All | Pending | Approved | Declined.
- **Table:** Columns: **Member** (name), Type, Reason, Details, Status, Submitted, **Actions (View)**. “Reviewed by” and “Review notes” are **not** in the table (keeps the section less crowded).
- **View button:** Every request has a **View** button. Execs do **not** use inline Approve/Decline in the table; they open **View** and approve/decline inside the modal.

**Request View modal (shared by members and execs)**

- **Shows:** Member (name, email), Type, Reason, Details, Status, Submitted, **Reviewed by** (reviewer name + date) if set, **Review notes** if set.
- **For execs on pending requests only:** The same modal includes an optional “Review notes” textarea and **Approve** / **Decline** buttons. Submitting updates `member_requests`: `status`, `reviewed_by`, `reviewed_at`, `review_notes`.

---

## Implementation checklist

1. **Migration:** Create `member_requests` table, indexes (`member_id`, `status`, `type`, `created_at`), RLS policies, and any `updated_at` trigger if desired.
2. **Dashboard – member:** New section “Leave & extension” with form (type, reason, optional fields) and list of own requests.
3. **Dashboard – exec:** New section “Leave & extension requests” (under “Your Info”) with filter (All / Pending / Approved / Declined), table with Actions (View), and Request View modal where execs Approve/Decline with optional review notes.
4. **Permissions:** Reuse existing “exec” check (e.g. `registration` or all four permissions). No new `members` columns required unless you want a dedicated “can review leave/extension” flag.
5. **COPILOT_CONTEXT.md:** Add `member_requests` to the schema section and a short “Leave & extension requests” workflow note.

---

## Optional later

- Email when request is approved/declined (once Brevo/Resend is in place).
- “Cancel” for pending requests (member-only; set status to `'cancelled'` or add a `cancelled_at` and filter those out from exec review).
- For extensions: link to a “projects” table if you add one later (replace `project_name` with `project_id` FK).

You can share this with Joel/Ben and, when you’re ready to implement, we can turn it into a concrete migration + dashboard changes step by step.
