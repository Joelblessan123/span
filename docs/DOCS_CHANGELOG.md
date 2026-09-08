# Changelog — docs & onboarding guide

Updates to the documentation and onboarding guide (repo `docs/`). **Newest first.**  
Dates use the **commit author date** (local calendar day) from `git log` for each change where a commit exists.

---

## 2026-09-07

- **Password reset / login identity** — `FIRST_LOGIN_AND_REGISTRATION.md` (§1b Forgot Password), `CODEBASE_ARCHITECTURE.md`, `COPILOT_CONTEXT.md`, `DEPLOYMENT.md` (deploy `password-reset` as **`hyper-endpoint`**), `email-templates/PASSWORD_RESET_EMAIL_TEMPLATE.html` + README, `README-REACT.md`, `ADDING_A_NEW_MEMBER.md`, `APPLYING_AND_APPLICATION_REVIEW.md` (AI screening), `DASHBOARD_FUNCTIONS.md` / `leave-and-extension-requests.md` (calendar), `DOCS_CHANGELOG.md`.
  - Lookup via `members.email` / `original_email`; Auth preferred by SPAN email; alphanumeric temp passwords; email states SPAN login address.
  - Support notes: temp password fails when logging in with personal email; frontend must call `hyper-endpoint`.
- **WORK_SUMMARY.txt §0** — Auth/password-reset detail; applications AI screening; leave calendar / dashboard UX; Classroom; HR lifecycle; security/perf; edge-function deploy aliases.

---

## 2026-05-03

- **Policy teams, member naming, assignments, RLS** — `ADDING_A_NEW_MEMBER.md`, `CODEBASE_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `DASHBOARD_FUNCTIONS.md`, `MIGRATION_POLICY_TEAMS.md`, `BILLS_EXEC_SUITE_SPEC.md`, `COPILOT_CONTEXT.md`, `DOCS_CHANGELOG.md`; `5acf2d5` (*feat: policy team kinds, member names, assignments, and member RLS fix*).
  - **Members:** optional `middle_name` and `preferred_name`; org email still derived from first + last; public display uses preferred name when present (`memberDisplayName.js`).
  - **Dashboard:** preferred name editable from the profile header; exec **Member Management** includes policy-team roster and co-leads per existing policy-team docs.
  - **Bill assignments:** assign-work flows respect policy-team context (e.g. bill-detail prefill where applicable).
  - **Migrations:** cross-linked `members_middle_name_preferred_name.sql`, `members_rls_use_jwt_email_not_auth_users.sql` (JWT email for self-update paths that must not subquery `auth.users`).

---

## 2026-03-30

- **README-REACT.md** — Brought in line with current app: § *Current feature surface* (aligned with `WORK_SUMMARY.txt` §0), removed stale vanilla-login / EmailJS / wrong application statuses; folder sketch; Resend + Edge Functions note.
- **Reference reframing** — Root **README**, **docs/README.md**, **SETUP.md**, **DEVELOPMENT.md**, **DEPLOYMENT.md**: informational tone; placeholders instead of production secrets/URLs in git.
- **README-ENV** — Discourages relying on hardcoded env fallbacks.
- **Pruned docs** — Removed `volunteer-hours-pdf-email.md`, `email-services-comparison.md`, `IMPLEMENTATION_SUMMARY.md` (superseded or redundant with `WORK_SUMMARY.txt` §0).
- **Removed** — `LEGISCAN_TIMELINE_SPEC.md`, `auth-provisioning.md` (replaced by code + SETUP / ADDING_A_NEW_MEMBER / FIRST_LOGIN).
- **WORK_SUMMARY.txt** — §0 *Current product overview (2026)*; org name fix; doc index updates.
- **Layout** — `README-REACT`, `README-ENV`, `DEPLOYMENT`, email HTML → under `docs/` / `docs/email-templates/`; new **docs/README.md** index.
- **Cross-links** — `COPILOT_CONTEXT`, `DASHBOARD_FUNCTIONS`, `APPLYING_AND_APPLICATION_REVIEW`, `ADDING_A_NEW_MEMBER`, `CODEBASE_ARCHITECTURE`, etc.

---

## 2026-03-24

- **Bill outreach + invitation defaults** — `BILLS_EXEC_SUITE_SPEC.md` (outreach scope), `COPILOT_CONTEXT.md`; aligns with `edc89b2` (*feat: bill outreach tab, invitation CC defaults*).

---

## 2026-03-22

- **Interview invitation email** — `APPLYING_AND_APPLICATION_REVIEW.md`, `DASHBOARD_FUNCTIONS.md`, `COPILOT_CONTEXT.md`, `DOCS_CHANGELOG.md`; `8dff33e`.
- **Research — Compare tab** — `BILLS_EXEC_SUITE_SPEC.md`, `DATABASE_ARCHITECTURE.md`, `COPILOT_CONTEXT.md`, `DOCS_CHANGELOG.md`; `8a188f3`.

---

## 2026-03-20

- **Bill Research (Legislature / SPAN)** — `COPILOT_CONTEXT.md`, `DOCS_CHANGELOG.md`; `784c92d`.
- **Bill work assignments (slice 1)** — `BILLS_EXEC_SUITE_SPEC.md`, `DATABASE_ARCHITECTURE.md`, `COPILOT_CONTEXT.md`, `DOCS_CHANGELOG.md`; `52e468f`.

---

## 2026-03-07

- **Volunteer hours UI + timeline** — `LEGISCAN_TIMELINE_SPEC.md` (since removed from repo) updated alongside dashboard/timeline work; `8525c97`.

---

## 2026-03-03

- **Ideas default filter** — `COPILOT_CONTEXT.md`; `a2f341b`.
- **Bill status popover / timeline** — `COPILOT_CONTEXT.md` + component docs in commit message; `f3c17ef`.

---

## 2026-02-22

- **Ideas & suggestions + LegiScan timeline** — `COPILOT_CONTEXT.md`, `LEGISCAN_TIMELINE_SPEC.md` (since removed); `74f3906`.

---

## 2026-02-15

- **Copilot context cleanup** — `COPILOT_CONTEXT.md`; `8acd3f8`.
- **Migrations in repo (reference)** — `2a40e43` (broader repo change; docs benefit from linked SQL in `supabase/migrations/`).

---

*When you add entries: prefer the **`git log --format=%ci`** date of the commit that touched `docs/` (or note “pending commit” until landed).*
