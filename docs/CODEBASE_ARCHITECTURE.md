# SPAN Codebase Architecture — At a Glance

This is the written summary for the **Codebase architecture** tab. It gives you a map of where things live and how the app is wired so you can find your way when you dive into each feature.

---

## 1\. Tech stack

**Frontend:** React 18 \+ Vite 5, Bootstrap 5 and Bootstrap Icons.   
**Backend:** Supabase (PostgreSQL, Auth, Storage, Edge Functions).   
**Deployment:** Static build to GitHub Pages.   
No separate Node server — the browser talks to Supabase directly using the Supabase JS client.

---

## 2\. How the app is built and “routed”

SPAN is **multi-page**, not a single-page app with client-side routing.

- There is **no React Router**. Each “page” is a **separate HTML file** in the project root: `index.html` (home), `bills.html`, `blog.html`, `login.html`, `dashboard.html`, `directory.html`, `our-story.html`, etc.  
- Each HTML file includes the same script: `/src/main.jsx`. The HTML has a single **root div** with an id like `home-root`, `bills-root`, or `dashboard-root`.  
- **`main.jsx`** runs on every page. It looks for whichever root div exists on that page and mounts **`App`** with a **`page`** prop (e.g. `'home'`, `'login'`, `'dashboard'`). So one HTML page \= one root \= one page name.  
- **`App.jsx`** is a big switch on `page`: it lazy-loads and renders the right page component (`HomePage`, `LoginPage`, `DashboardPage`, etc.). Heavy pages are loaded on demand via `lazy()`.  
- **Navbar** and **Footer** are mounted once into `#navbarContainer` and `#footerContainer`, which exist on every HTML page. So layout is consistent without React Router.

**Protected vs public:** There’s no router guard. The **dashboard** is “protected” because `DashboardPage` checks the Supabase session on load; if there’s no session, it redirects to `login.html`. `LoginPage` redirects to `dashboard.html` if the user is already logged in.

---

## 3\. Folder structure (where to look)

span/

├── index.html, bills.html, login.html, dashboard.html, ...   \# One HTML file per “route”

├── src/

│   ├── main.jsx          \# Entry: mounts App \+ Navbar \+ Footer by root id

│   ├── App.jsx           \# Switch on page prop → lazy-loaded page component

│   ├── App.css, index.css

│   ├── pages/            \# One component per screen (HomePage, LoginPage, DashboardPage, …)

│   ├── components/       \# Reusable UI (Navbar, Footer, BillCard, ApplicationForm, …)

│   └── lib/              \# Shared utilities

│       ├── supabase.js   \# Supabase client (import this for DB/Auth/Storage)

│       ├── legiscan.js   \# LegiScan API helper

│       ├── memberDisplayName.js   \# Public vs legal display names (preferred / first+middle+last)

│       └── generateVolunteerPDF.js   \# Client-side PDF for volunteer verification

├── supabase/

│   ├── migrations/       \# SQL: tables, RLS, functions (run in order)

│   └── functions/        \# Edge Functions (Deno/TS): members-provision, password-reset, etc.

└── docs/                 \# Setup, DB architecture, this file, etc.

- **Pages** \= one big component per screen; they often hold a lot of state and call Supabase.  
- **Components** \= reusable pieces used by pages (or by other components). Things like forms, cards, modals live here.  
- **lib** \= single Supabase client and helpers. No duplicate Supabase clients; always import from `src/lib/supabase.js`.  
- **supabase/migrations** \= source of truth for schema and RLS. **supabase/functions** \= serverless endpoints (invoked by the app or by Supabase triggers).

---

## 4\. Where key things live

| What | Where |
| :---- | :---- |
| **Supabase client** | `src/lib/supabase.js` — import `{ supabase }` and use for `.from()`, `.auth`, `.storage`, `.rpc()`. |
| **Env vars** | `.env.local` in project root. Only vars starting with **`VITE_`** are available in the browser (`import.meta.env.VITE_SUPABASE_URL`, etc.). |
| **Navbar / Footer** | `src/components/Navbar.jsx`, `src/components/Footer.jsx`. Mounted in `main.jsx`. |
| **Auth checks** | Done inside pages (e.g. `DashboardPage` uses `supabase.auth.getSession()` and redirects to `login.html` if no session). Member data loaded from `members` table by matching `user_id` to `auth.uid()`. |
| **Permissions (volunteer, applications, bills, registration, blog)** | Stored on the `members` row. The app reads the current member and checks those booleans before showing admin UI or calling admin-only RPCs. |
| **Styles** | Bootstrap 5 (CDN) \+ Bootstrap Icons. Page- or component-specific CSS files live next to the component (e.g. `DashboardPage.css`). |

---

## 5\. Patterns

- **Data:** Use `supabase.from('table_name').select()`, `.insert()`, `.update()` for normal CRUD. RLS on the server decides what the current user can see or change.  
- **Auth:** `supabase.auth.getSession()`, `signInWithPassword()`, `signOut()`. Session is a JWT; the app sends it with every request.  
- **Admin actions:** When the app needs to do something that RLS would block (e.g. create/update another member), it calls **RPCs** defined in migrations (e.g. `create_member`, `update_member`). Those run with elevated privileges.  
- **Files:** Upload to a Storage bucket (e.g. `members-images`), then save the **filename** (or path) in the relevant table. Download or display via `supabase.storage.from('bucket').getPublicUrl(filename)` or similar.  
- **Permissions in UI:** Load the current user’s `members` row; check `member.volunteer`, `member.applications`, etc. “Executive director” \= all four true. Show or hide sections and buttons based on that.

---

## 6\. Edge Functions (where they live and when they’re used)

All live under **`supabase/functions/`**. Each is a separate function deployed to Supabase, that basically does an action behind-the-scenes on the server:

| Function | Purpose |
| :---- | :---- |
| **members-provision** | Runs after a new member (and Auth user) is created; sends welcome email with temporary password. |
| **password-reset** | Forgot Password flow: resolves member by SPAN or personal email, sets alphanumeric temp password on the SPAN Auth user, emails via Resend (usually to `original_email`). **Deployed in production as `hyper-endpoint`** (login page calls that URL). |
| **dashboard-view** | Deployed as `view-member-dashboard`. GET with `member_id`; returns that member’s dashboard data. Only callable by execs (all 4 permissions). |
| **send-rejection-email** | Sends application rejection email (Resend) |
| **send-volunteer-verification** | Sends volunteer verification PDF to member’s email. Exec-only. |

The frontend calls them via `supabase.functions.invoke('function-name', { body: { ... } })` or (for dashboard-view) a GET with the session JWT. Feature subtabs will call out when a given feature uses an Edge Function.

---

## 7\. Quick reference: page → file

| Page / area | HTML | Root id | Main component |
| :---- | :---- | :---- | :---- |
| Home | index.html | home-root | HomePage |
| Bills | bills.html | bills-root | BillsPage |
| Blog (list) | blog.html | blog-root | BlogPage |
| Blog post | blog-post.html | blog-post-root | BlogPostPage |
| Directory | directory.html | directory-root | DirectoryPage |
| Our Story | our-story.html | our-story-root | OurStoryPage |
| Login | login.html | login-root | LoginPage |
| Dashboard | dashboard.html | dashboard-root | DashboardPage |
| Bills preview (embedded) | (other) | bills-preview-root | BillsPreview |
| Bills stats (embedded) | (other) | bills-stats-root | BillsStats |

---

## 8\. Public-facing pages (what visitors see)

These pages are visible to everyone (no login required). A short overview of each and where the data comes from. You can add screenshots of each page in the Google Doc if that helps.

### Home (`index.html` → HomePage)

- **What visitors see:** Hero, about section, “Join Our Movement” (application form), schools carousel, partners carousel, team section (member photos/bios), impact map.  
- **Data:**   
  - **Application form** posts to `applications` (and optional resume to `applications-resumes` bucket);   
  - **SchoolsCarousel** loads from `schools` (active only);   
  - **PartnersCarousel** from `partners` (active only);   
  - **TeamSection** from `members` (for team display; names use **preferred public name** when set, otherwise legal first/middle/last).   
  - HomePage itself doesn’t call Supabase; the child components do.  
      
- **Where:** `src/pages/HomePage.jsx`, plus `src/components/ApplicationForm.jsx`, `SchoolsCarousel.jsx`, `PartnersCarousel.jsx`, `TeamSection.jsx`, `ImpactMap.jsx`.

### Bills (`bills.html` → BillsPage)

- **What visitors see:** List of legislation (bills) with filters (position, state), search, and for each bill, a **card** showing name, description, position, date, optional PDF viewer, optional LegiScan status, collaborator avatars.  
- **Data:**   
  - **Bills** from `bills` table — only rows with `status = 'approved'` or `'modified'` (so the public never sees under\_review or rejected bills).   
  - **Collaborator avatars** from `members`.   
  - **PDFs** from the `proposals` storage bucket (by state and bill name).  
- **Where:** `src/pages/BillsPage.jsx`.   
  - Components: `BillCard`, `PDFViewer`, `CollaboratorAvatars`, `Pagination` in `src/components/`.   
  - Optional LegiScan helper in `src/lib/legiscan.js`.

### Blog (`blog.html` → BlogPage)

- **What visitors see:** Blog posts in a list (featured post first, then paginated). Each post has a title, excerpt, author, link to full post.  
- **Data:** Posts come from **Medium via RSS** (using rss2json.com), not from our database.   
  - Author names are optionally matched to **members** (using the same display-name rules as the directory) so they can link to the Directory profile.  
- **Where:** `src/pages/BlogPage.jsx` (fetches RSS, optionally loads members for directory links). Individual post view: `BlogPostPage.jsx` (same RSS/post data, single post). `BlogCard` in `src/components/`.

### Our Story (`our-story.html` → OurStoryPage)

- **What visitors see:** Static content — SPAN’s origin, mission, and story (e.g. Texas HB 5294, coalition, pass/fail victory). No dynamic data.  
- **Data:** None from Supabase or APIs. Copy and layout only.  
- **Where:** `src/pages/OurStoryPage.jsx` and `OurStoryPage.css`.

### Directory (`directory.html` → DirectoryPage)

- **What visitors see:** List of **active** SPAN members with photo, **display name** (preferred name when set, otherwise legal name), role, and optional links (e.g. email, LinkedIn). Often filterable or searchable.  
- **Data:**   
  - **Members** from `members` table (typically `active = true` only for public directory).   
  - Profile photos from `members-images` storage bucket.  
- **Where:** `src/pages/DirectoryPage.jsx`.

---

Once this map is clear, the feature subtabs focus on what each feature does and where in these folders and files the logic lives.