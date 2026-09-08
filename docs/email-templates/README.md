# Email HTML references

Static HTML files here are **reference copies** for designers or for pasting into external tools. They are **not** loaded by the app at runtime.

**Actual sends** use HTML built inside Supabase Edge Functions, for example:

- `supabase/functions/password-reset/` (production deploy name: **`hyper-endpoint`**)
- `supabase/functions/members-provision/`
- `supabase/functions/send-invitation-email/`
- `supabase/functions/send-onboarding-schedule-email/`
- `supabase/functions/send-rejection-email/`
- `supabase/functions/send-volunteer-verification/`

When you change copy or layout for production, update the corresponding function (and keep these files in sync if you still use them as scratch templates). Password-reset reference HTML should include the **login email (SPAN)** callout — see `PASSWORD_RESET_EMAIL_TEMPLATE.html`.
