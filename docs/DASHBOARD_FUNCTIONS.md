# Dashboard: member experience & exec actions

The dashboard is a single page (`src/pages/DashboardPage.jsx`) that shows or hides sections based on the logged-in member’s permissions. Below: section order, what a typical member sees, what each permission adds, and what execs get on top (execs have all five flags—volunteer, applications, bills, registration, blog—plus a few exec-only actions such as view-as).

**Section order** — Main dashboard sections are in a flex container with CSS `order` so they appear in a fixed sequence. Sections that don’t apply (e.g. Bill Management for members) use `order: 99` so they stay at the end and don’t affect the visible order.

- **Members:** Your Info → Leave & Extension Requests → Bill Submission → Volunteer Hours → Ideas & Suggestions → HR Reports → Change Password.
- **Execs:** Your Info → Leave & Extension Requests → Bill Management → New Member Applications → Ideas & Suggestions → Volunteer Hours → HR Reports → Member Management → Schools & Partners → Change Password.

---

## 1. What every regular member sees

After registration is complete, every member sees these sections (in the order above).

- **Profile header** — Photo (or initials), name, role, LinkedIn/Instagram links, "Change profile picture", and "Download My SPANCard." **Preferred public name** (if used) can be edited inline next to the heading via the pencil control.
- **Your Info** — Read-only contact and profile info from their `members` row (legal and contact fields; display naming follows **`memberDisplayName`** helpers).
- **Leave & extension requests** — Submit a leave/break or extension request; view their own requests (View button opens modal with details and, for execs, approve/decline and comments). The Leave section also hosts a **unified calendar** (birthdays, SPAN events, team-lead deadlines) where enabled — see `dashboard_calendar_events` and leave calendar UI components.
- **Ideas & suggestions** — Submit an idea (bill idea, general interest, or web/feature suggestion) with title and optional description; view their own suggestions and status. The list defaults to the **Pending** filter for execs.
- **Volunteer Hours** — Add their own entries (date/time or hours, job title, description); view their own entries with status (waiting / approved / denied) and supervisor comment.
- **HR Reports** — Submit an HR report; view their own reports.

So by default: your profile, your volunteer entries, your requests, your reports. No bills section, no applications section, no member list — those appear only when the member has the right permission.

---

## 2. What each permission adds

### Volunteer

- **See:** All members' volunteer entries, grouped by member (left image)
- **Do:** Approve or deny any entry and add a supervisor comment (except for self)
- **Note:** The "Generate verification letter" / send PDF to a member's email is exec-only (right image).

*Figure: volunteer hr display for volunteer permission. Execs can send verification letters.*

### Applications

- **See:** The Applications section — full list of applications with filters (All, Pending, Invited, Met with, Onboard, Accepted, Rejected), school grade and internal **review score** column, and per-application review score in the detail modal.
- **Do:** Open an application, **Mark Invited** (preview + send interview email via Resend, then status becomes Invited), **Mark Met with** (date), **Mark Onboard** (preview + send onboarding scheduling email via Resend, then status Onboard), add notes, Accept (opens Add Member with data pre-filled), or Reject (with optional rejection email).
- For a visualization, see section 2 of applying to SPAN.

### Bills

- **See:** A Bills section.
- **Do:**
  - If you are **not** an exec (left image): submit bills; they are saved as under_review and only go public after an exec approves. You must provide **either** a proposal PDF **or** a link to the proposal document (e.g. Google Doc), and **at least one collaborator**. In **My Submitted Bills** you can view each submission (View PDF, open Google Doc link, LegiScan link).
  - If you **are** an exec (right image): see all bills, approve/reject/modify, edit/delete, and upload PDFs to the proposals bucket. When approving you can choose **Approve** (make live) or **Approve but hide** (approved but not shown on the public Bills page). In Edit you can toggle **Hide from public site**. Hidden bills stay in the backend and are visible in Bill Management and to the submitter; they show a **Hidden** badge.

*Figure: bill views for bill permission members and execs.*

### Registration

- **See:** Member Management (active and inactive member list). Exec view also includes **Policy teams** (roster, co-leads, team kind) per `docs/MIGRATION_POLICY_TEAMS.md`.
- **Do:** Add a new member, edit any member (details), set active/inactive; optional middle name and preferred public name on the form.
- **Note:** Only execs can edit member perms (volunteer, applications, bills, registration, blog)

*Figure: member management section allows viewing member list*

So: volunteer = see all volunteer entries + approve/deny; applications = applications section + review applications; bills = submit bill (or full management if exec); registration = member list + edit members.

---

## 3. Execs: all permissions + special abilities

To recap, **Exec** = member with all four permissions (volunteer, applications, bills, registration). So they see every section above and can do everything each permission allows.

On top of that, a few things are **exec-only** (require all four):

- **View as** — Open `/dashboard.html?viewAs=<member_id>` (e.g. from "View dashboard" in Member Management). The dashboard calls the view-member-dashboard Edge Function and shows that member's data (profile, volunteer entries, leave requests, bills, applications) in read-only form. Only execs can use this; the Edge Function checks that the caller has all four permissions.
- **Volunteer verification email** — Generate a PDF verification letter for a member's approved volunteer hours and send it to their email via the send-volunteer-verification Edge Function. Any member with volunteer permission can approve/deny entries; only execs can trigger the verification email.
- See all HR reports submitted by all members and change status of reports.
- See all Leave/Extension Requests submitted and approve/decline (or change status) and leave comments via the Request View modal.
- See all Ideas & suggestions; set status (pending / under review / approved / declined) and leave review notes (comments) in the Suggestion View modal. The Ideas & Suggestions list **defaults to Pending**.

---

## 4. Views and actions summary

| Action | Who (Permissions) | Notes |
|--------|-------------------|-------|
| View another member's dashboard | Exec only | `?viewAs=<member_id>`, view-member-dashboard Edge Function |
| Member Management | Registration permission | Add/edit members, active/inactive |
| Review Applications | Applications permission | Review app, accept/reject, send rejection email |
| Bill Management (all bills, approve/edit) | Exec | Non-exec with bills perm can only submit for review |
| Bill Management: Approve vs Approve but hide | Exec | Hidden bills stay in backend, not on public Bills page |
| Volunteer: approve/deny entries | Volunteer permission | See all entries, add supervisor comment |
| Volunteer: send verification PDF | Exec | send-volunteer-verification Edge Function |
| Leave/extension: approve or decline | Exec | See all requests |
| HR Reports: view all, update status | Exec | See all except reports regarding yourself |
| Ideas & suggestions: view all, set status, leave comments | Exec | member_suggestions; Suggestion View modal |

---

## 5. Where it lives and reference

All dashboard UI and loading logic live in `src/pages/DashboardPage.jsx`. The component uses the current member (or, in view-as mode, the member being viewed) and checks `hasPermission(<perm>)`; so, exec is `hasPermission('volunteer') && hasPermission('applications') && hasPermission('bills') && hasPermission('registration')`. RLS on the backend ensures members only read or update what their permissions allow.

**Section order implementation:** A `dashboardOrder` object is defined from `isExec` and applied as `style={{ order: dashboardOrder.<section> }}` on each section. The flex wrapper uses `display: 'flex'` and `flexDirection: 'column'` so the visual order follows those values; sections that don’t apply use `order: 99`.

| Area | Table(s) / storage | Key RPCs / functions |
|------|--------------------|------------------------|
| Profile | members | update_own_member_image (own photo) |
| Volunteer hours | volunteers | — |
| Bills | bills | — |
| Leave/extension | member_requests | — |
| Ideas & suggestions | member_suggestions | — |
| HR Reports | hr_reports | — |
| Applications | applications | — |
| Member mgmt | members | create_member, update_member |
| View as (read-only) | — | Edge Function: view-member-dashboard |
| Verification PDF | — | send-volunteer-verification (exec only) |
