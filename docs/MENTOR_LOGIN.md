# Mentor dashboard logins

Board of Mentors profiles live in **`advisors`** (public Leadership tab). Mentors are **not** `members` rows, so they never appear on the membership Directory list.

## Invite self-registration (preferred)

1. Dashboard → **Schools, Partners & Mentors** → Board of Mentors → **Copy invite link**.
2. Send that link to the mentor (email/Slack/etc.). Link is token-gated (`mentor-join.html?invite=…`), `noindex`, expires in ~30 days. **Revoke invites** invalidates outstanding links.
3. Mentor submits: name, email, phone, photo, LinkedIn, affiliation (title + org).
4. System **automatically**:
   - Creates an **active** `advisors` row (shows on Board of Mentors)
   - Creates Auth + `mentor_accounts` (login ready)
   - Emails username + temporary password + Mentor login link

No manual Activate or Provision for invite signups.

## Manual Add Mentor (fallback)

Exec **Add Mentor** still works. Use **Provision login** / **Reset password** for exec-created mentors without email (synthetic username).

## Login

`/login.html?mode=mentor` — username **or** the email they registered with.

Dashboard: Research + Outreach (+ Change password). Send-via-SPAN-email stays disabled for mentors.

## Deploy

1. Migrations: `create_mentor_accounts.sql`, `mentor_accounts_bills_select_rls.sql`, `mentor_session_allow_inactive_advisor.sql`, **`mentor_join_invites.sql`**.
2. Edge functions (JWT verify off where noted):
   - `mentors-provision` (`--no-verify-jwt`)
   - `mentors-invite` (`--no-verify-jwt`)
   - `mentors-join` (`--no-verify-jwt`) — public submit
   - `fetch-legiscan-person-contact`, `outreach-send-email` (mentor preview / block send)
3. Frontend including `mentor-join.html`.
4. Secrets: `RESEND_API_KEY`; optional `PRODUCTION_URL`, `MENTOR_JOIN_FROM`.
