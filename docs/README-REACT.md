# SPAN site — React / Vite (technical reference)

The public site is a **multi-page** setup: each route is an HTML file in the repo root that mounts a React page via **`src/main.jsx`** / **`App.jsx`** (see **CODEBASE_ARCHITECTURE.md**). **Vite** builds the bundle; output goes to **`dist/`** for static hosting.

**Canonical shipped behavior:** **[../WORK_SUMMARY.txt](../WORK_SUMMARY.txt)** §0. This file adds **React/Vite-oriented** context; the **§ Current feature surface** section below tracks the app today, then **Historical notes** keep migration-era detail without duplicating the whole codebase.

## Build commands

```bash
npm install    # dependencies
npm run dev    # local dev server (port from Vite, often 5173)
npm run build  # production bundle → dist/
npm run preview
```

Local credentials: **[SETUP.md](./SETUP.md)** and **[README-ENV.md](./README-ENV.md)**.

---

## Current feature surface (summary)

Authoritative detail: **[../WORK_SUMMARY.txt](../WORK_SUMMARY.txt)** §0 and **[DASHBOARD_FUNCTIONS.md](./DASHBOARD_FUNCTIONS.md)**. At a glance:

- **Permissions:** `volunteer`, `applications`, `bills`, `registration`, `blog` on `members`; execs have all five.
- **Public:** Home, Bills (PDF/Doc links, LegiScan, optional status timeline), Blog + post page, Directory (incl. advisory board where configured), Our Story, Application form.
- **Auth:** **`LoginPage.jsx`** — SPAN email login; Forgot Password → **`hyper-endpoint`** (source `password-reset/`). See **FIRST_LOGIN_AND_REGISTRATION.md**.
- **Dashboard (`DashboardPage.jsx`):** profile, leave/extension + **unified calendar** (birthdays/events/deadlines), dark mode, bills (submit + exec management), **assigned work / open pool**, **research** (SPAN + LegiScan + compare), **outreach**, applications (pipeline + Resend emails + **AI screening**), volunteer hours, ideas/suggestions, HR/conduct lifecycle, member management, schools/partners, **Classroom** (where enabled), Medium OTP (**blog** perm), password change, exec **view-as**.
- **Transactional email:** Mostly **Resend** via Edge Functions (invite, onboard scheduling, rejection, volunteer verification, password reset, etc.); see **`supabase/functions/`** and **COPILOT_CONTEXT.md**.

---

## Historical notes (migration-era)

### Bills (public)

- PDF viewer, keyword extraction, collaborator search, pagination — still accurate at a high level; see also hidden bills, Google Doc links, and LegiScan timeline on cards.

### Blog

- Medium RSS, featured + pagination, author links, shared pagination.

### Applications

- Native **`ApplicationForm`** on the home page (includes age, referral, friend name when applicable).
- Exec application UI: filters, pipeline **`pending` → `invited` → `met_with` → `onboard` → `accepted` / `rejected`**, interview + onboarding **preview emails**, met-with date, notes, numeric review score, import into Add Member.

### Members

- **`create_member`** / provisioning; **`RegistrationForm`** on first login; permissions are **boolean flags**, not legacy “tier” as the source of truth.

## React pages and major UI

**Pages (`src/pages/`):** `HomePage`, `BillsPage`, `BlogPage`, `BlogPostPage`, `DirectoryPage`, `OurStoryPage`, `LoginPage`, `DashboardPage`, and others as added.

**Large dashboard concerns** live mainly in **`DashboardPage.jsx`** plus panels such as **`BillResearchPanel`**, **`BillOutreachPanel`**, bill assignment UI, etc. (**`src/components/`**).

**Status:** User-facing routes are React; **`assets/scripts/`** may still contain legacy helpers for older HTML—prefer **`src/`** for new work.

## Operational notes

1. **Deploy:** Static build from **`dist/`** (e.g. GitHub Pages) — **[DEPLOYMENT.md](./DEPLOYMENT.md)**.
2. **Env:** **[README-ENV.md](./README-ENV.md)**.
3. **PDF.js:** Worker under **`public/pdfjs/`** (or as configured); must be reachable in production.
4. **Provisioning:** **`members-provision`** + **[ADDING_A_NEW_MEMBER.md](./ADDING_A_NEW_MEMBER.md)**, **[FIRST_LOGIN_AND_REGISTRATION.md](./FIRST_LOGIN_AND_REGISTRATION.md)**.

## Architecture (folder sketch)

```
src/
├── components/     # Shared UI (Navbar, BillCard, ApplicationForm, BillResearchPanel, …)
├── pages/          # One bundle per HTML route; DashboardPage.jsx is very large
├── lib/            # supabase.js, legiscan.js, generateVolunteerPDF.js, etc.
├── App.jsx         # Chooses page from `page` prop
└── main.jsx        # Mounts App + Navbar/Footer into each HTML root div
```

See **CODEBASE_ARCHITECTURE.md** for the HTML file ↔ root id ↔ page name table.

**Member provisioning:** webhook / `INSERT` on `members` → **`supabase/functions/members-provision/`** (Resend welcome path as implemented). **[SETUP.md](./SETUP.md)** for secrets.

## Database functions & policies (summary)

### Member Management Functions

1. **`create_member()`** (and related RPCs): privileged member creation used from the dashboard; caller must satisfy the project’s **exec** checks (see migrations / `create_member` definition)
   - Inserts `members` row and triggers provisioning pipeline

2. **`update_member_registration()`**: Allows members to update their own registration
   - Verifies caller is updating their own record
   - Handles phone number type conversion (text to bigint)
   - Updates all registration fields including profile photo

### Storage Policies

- **`members-images` bucket policies**:
  - Authenticated users can upload/update/delete their own profile images
  - Files must be named with their `member_id` (e.g., `{member_id}.png`)
  - Public read access for displaying images on the website

### Applications table (high level)

- Anonymous insert for public apply; members with **`applications`** permission read/update per RLS.
- **Status:** `pending`, `invited`, `met_with`, `onboard`, `accepted`, `rejected` (plus optional internal fields — see **DATABASE_ARCHITECTURE.md** / migrations).

**Schema source of truth:** run **`supabase/migrations/`** in order on your Supabase project (CLI or SQL editor)—do not rely on a short list of old filenames here.

## Email

Production transactional email is implemented in **Edge Functions** (HTML in code) and mostly **Resend**. Variable names / copy live next to each sender in **`supabase/functions/`**. Scratch HTML copies may exist under **`docs/email-templates/`**.

## Possible future work

Examples: broader automated tests, error boundaries, bundle analysis, further splitting **`DashboardPage.jsx`** into smaller modules. Not an exhaustive roadmap.

## Troubleshooting

### PDF Viewer Not Working
- Check that `pdfjs-dist` worker is properly loaded
- Verify CORS settings for PDF URLs
- Check browser console for errors

### Build Issues
- Make sure Node.js version is 18+
- Delete `node_modules` and `package-lock.json`, then reinstall
- Check Vite configuration

