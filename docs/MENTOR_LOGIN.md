# Mentor dashboard logins

Board of Mentors profiles live in **`advisors`** (public Leadership tab). Mentors are **not** `members` rows, so they never appear on the membership Directory list.

## What we built

1. **`mentor_accounts`** — links an advisor to a Supabase Auth user.
2. **Synthetic username** — e.g. `jane.doe.4821` maps to Auth email `jane.doe.4821@mentors.spanationwide.org` (no real inbox / no Cloudflare).
3. **Login** — `/login.html?mode=mentor` → **Mentor** tab → username + password.
4. **Dashboard** — Research + Outreach (+ Change password) only. No HR, applications, ideas, volunteer, leave, resign.
5. **Provision UI** — Schools, Partners & Mentors → Board of Mentors → **Provision login** / **Reset password**. Credentials show once in a modal for the exec to copy and share.
6. **Outreach for mentors** — they can pull LegiScan contacts, compose, preview, and copy messages. **Send via SPAN email** and **reference copy** are greyed out (and blocked server-side). Mentors do not send on SPAN’s behalf.

## Deploy steps

1. Run migration: `supabase/migrations/create_mentor_accounts.sql` in the Supabase SQL editor.
2. Deploy edge functions:
   - **`mentors-provision`** (new) — creates Auth user + returns username/password for the exec modal.
     Redeploy with JWT verification **off** at the gateway (`config.toml` has `verify_jwt = false`, or CLI:
     `supabase functions deploy mentors-provision --no-verify-jwt`). Otherwise browser OPTIONS preflight fails with CORS.
     Auth is still checked inside the function (exec only).
   - **`fetch-legiscan-person-contact`** — allows mentor sessions to pull legislator contact info (demo of the policy flow).
   - **`outreach-send-email`** — explicitly **rejects** mentor sends (UI already greys the buttons; this is the server backstop).
3. Ship the frontend (GitHub Pages / usual deploy).

## Exec flow

1. Ensure the person is on Board of Mentors (`advisors`).
2. Click **Provision login**.
3. Copy username + temp password from the modal; share out of band.
4. Mentor opens login → **Mentor** → signs in → Policy tools (Research / Outreach).

Password resets: **Reset password** on the same row (again shown once in the modal). Mentors cannot use Forgot Password (no email).
