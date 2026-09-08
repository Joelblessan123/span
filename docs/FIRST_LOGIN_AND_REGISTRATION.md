# First login & registration

What happens when a **new member** logs in for the first time (e.g. with the temporary password from the welcome email) and how **registration completion** gates access to the full dashboard. It’s the step right after “Adding a new member”: the member now has an Auth account and a `members` row with `registration_complete = false`; this flow gets them to `registration_complete = true` and into the main dashboard.  
---

## 1\. Logging in

**What happens:** The new member goes to the **login page** (`login.html`), enters their **SPAN email** (`…@spanationwide.org`) and the **temporary password** from the welcome email. If they type only the local part (e.g. `firstname.lastname`), the app auto-appends `@spanationwide.org`. On success, they are redirected to **`/dashboard.html`**.

**Important:** Auth login is always the SPAN address on `members.email`, not `original_email` (personal). Personal email is for delivery of welcome/reset messages only. The login form labels this and warns if someone tries a non-SPAN address.

If they arrived via a **password recovery hash** in the URL, the login page can show a “set new password” form once the session is established. For a brand‑new member using the temp password, the normal path is email \+ password → redirect to dashboard.

**Where it lives:**

- **Page:** **`src/pages/LoginPage.jsx`**. It uses `supabase.auth.signInWithPassword({ email, password })`. On success it sets `window.location.href = '/dashboard.html'`. If the user already has a session when the page loads (e.g. they’re already logged in), it redirects to the dashboard immediately so they can’t “get stuck” on the login page.

**Note:** Login does not read `registration_complete`; `DashboardPage` branches on that flag after loading the member row.  
---

## 1b\. Forgot password (temporary password reset)

**What happens:** On the login page, **Forgot Password?** opens a modal. The member can enter their **SPAN or personal** email. The frontend POSTs to the password-reset Edge Function (see deploy name below). The function:

1. Looks up **`members`** by `email` or `original_email` (case-insensitive).
2. Resolves the Auth user preferentially by **SPAN login email** (`members.email`), then by `members.user_id`, then creates/links an Auth user if the member row exists but Auth does not.
3. Sets an **alphanumeric** temporary password on that Auth user (special characters were avoided because HTML email clients can mangle `&` etc. when copying).
4. Syncs Auth email to the SPAN address when mismatched, and re-links `members.user_id` to the account that was reset.
5. Emails the temp password via **Resend** to **`original_email`** when present, otherwise to the SPAN email. The email body shows the **exact SPAN login email** to use at login.

**Where it lives:**

- **UI:** `src/pages/LoginPage.jsx` → `fetch(`${VITE_SUPABASE_URL}/functions/v1/hyper-endpoint`, …)` with `{ email }`.
- **Source:** `supabase/functions/password-reset/index.ts`.
- **Deploy name:** production is historically deployed as **`hyper-endpoint`** (legacy function name). Redeploy with that name so login keeps working; renaming the local folder alone does not rename the live function. See **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

**Support tip:** If someone says “temp password doesn’t work,” confirm they are logging in with **`@spanationwide.org`**, not the personal inbox that received the email.

---

## 2\. Dashboard: registration gate

**What happens:** When the user lands on **`dashboard.html`**, the **Dashboard** app loads and runs **`loadMemberData`**. That gets the current session (`supabase.auth.getSession()`). If there’s no session, the user is redirected to **`/login.html`**. If there is a session, the app looks up the **member** row (by `user_id` from the session, or by email as fallback) from the **`members`** table. If no member is found, the user stays on the dashboard but with no member data (error/empty state). If a member is found, that member object is stored in state.

Then the dashboard decides what to render:

- If **`member.registration_complete`** is **false**, it does **not** render the full dashboard. Instead it renders only the **registration form** (see below). Once the member submits that form and it completes successfully, the app refreshes member data; on the next render `registration_complete` is true, and the full dashboard is shown.  
- If **`member.registration_complete`** is **true**, the full member dashboard is shown.

So: **first login after being added → dashboard loads → sees registration form until they complete it → then sees full dashboard.**

**Where it lives:**

- **`src/pages/DashboardPage.jsx`**. Session check and redirect to login happen inside `loadMemberData`.   
  - Member is fetched with `supabase.from('members').select('*').eq('user_id', userId)` (or by email).   
  - The conditional that shows the registration form is: `if (!member.registration_complete) { return ( ... <RegistrationForm ... /> ) }`.   
- After the form is completed, the form calls **`onComplete`**, which is **`handleRegistrationComplete`** — it simply calls **`loadMemberData()`** again so the member state is refreshed and the next render shows the full dashboard.

**UI behavior:** While `registration_complete` is false, only the registration form is rendered; the rest of the dashboard is hidden until the RPC succeeds and `loadMemberData` runs again.   
---

## 3\. Registration form: what they fill out and what happens

**What happens:** The **registration form** is a single form that collects the information we need to finish the member’s profile. Required fields typically include: **first name**, **last name**, **position/role**, **email**, **phone** (10-digit, formatted), **date of birth**, **school**, **city**, **state** (2-letter). Optional: LinkedIn, Instagram, additional info (notes). A **profile photo** is required: the user selects an image file; the form uploads it and saves the filename on the member record.

When they submit:

1. **Profile image:** If they chose a new image, the app uploads it to the **`members-images`** storage bucket in Supabase, with filename **`{member_id}.{ext}`** (e.g. `uuid.jpg`). If they already had an image (e.g. from a previous partial save), the form can keep that and not re-upload.  
2. **Member update:** The app calls an RPC (e.g. **`update_member_registration`**) with the form values and the image filename (or existing image path), and sets **`p_registration_complete: true`**. That RPC updates the current member’s row: name, email, phone, DOB, school, city, state, role, social links, notes, image, and **`registration_complete`**. The RPC is designed so the member can only update their **own** row (e.g. by checking that the session’s `user_id` matches the member’s `user_id`), and it runs with privileges that allow the update even if RLS would otherwise restrict it.  
3. **Refresh:** On success, the form shows a success message and calls **`onComplete()`**. The parent (DashboardPage) then runs **`loadMemberData()`**, so the member state now has **`registration_complete: true`**. The dashboard re-renders and shows the **full dashboard** instead of the registration form.

**Where it lives:**

- **Component:** **`src/components/RegistrationForm.jsx`**. It receives **`member`** (the current member object) and **`onComplete`** (callback to run after a successful submit). It pre-fills the form from `member` when it mounts. Validation: required fields, phone length, email format, state length, and “profile photo required” (either a new file or `member.image` already set).  
- **Upload:** `supabase.storage.from('members-images').upload(fileName, profileImage, { cacheControl: '3600', upsert: true })` with `fileName = ${member.member_id}.${fileExt}`.  
- **RPC:** `supabase.rpc('update_member_registration', { p_member_id, p_first_name, p_last_name, p_role, p_email, p_phone, p_dob, p_school_name, p_city, p_state, p_linkedin, p_instagram, p_notes, p_image, p_registration_complete: true })`. The exact parameter names and the RPC definition live in the migrations; the form is the main place that calls it.

**Data:**

- **Table:** **`members`**. The RPC updates the same row the user is tied to (by `user_id`). Key column for this flow: **`registration_complete`** is set to **true** so the dashboard will never show the registration form again for this member.  
- **Storage:** **`members-images`** — one file per member, filename **`{member_id}.{extension}`**.

---

## 4\. Summary flow

| Step | Who  | What |
| :---- | :---- | :---- |
| 1 | New member | Opens login page, enters **SPAN** email \+ temp password from welcome email. |
| 1b | Existing member (optional) | Forgot Password → personal or SPAN email → temp password emailed; still logs in with SPAN email. |
| 2 | Login page | `signInWithPassword` → success → redirect to `/dashboard.html`. |
| 3 | Dashboard | Loads, gets session, fetches member by `user_id`/email. If no session → redirect to login. |
| 4 | Dashboard | If `member.registration_complete === false` → render only **RegistrationForm**. |
| 5 | New member | Fills required fields (name, email, phone, DOB, school, city, state, role) and uploads profile photo. Submits. |
| 6 | RegistrationForm | Uploads image to `members-images` as `{member_id}.{ext}`; calls **update\_member\_registration** RPC with all fields and **registration\_complete: true**. |
| 7 | Dashboard | `onComplete()` → `loadMemberData()` → member state refreshes → **registration\_complete** is true → full dashboard is shown. |

From here, the member uses the dashboard like any other member (volunteer hours, bills/hours/applications/registrations if they have permission, leave/extension requests, etc.). Exec-specific flows (member management, viewing another member’s dashboard, etc.) are covered in the next sections.