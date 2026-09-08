# Documentation (reference)

These files describe **how SPAN is structured and how features work**. They are meant for maintainers, future-you, and tooling (e.g. AI context)—not as a contributor onboarding packet. Credentials and production identifiers stay out of git; see **[SETUP.md](./SETUP.md)** for the shape of config only.

| Doc | Purpose |
| --- | --- |
| [README-REACT.md](./README-REACT.md) | Vite/React scripts, stack overview, historical feature notes |
| [README-ENV.md](./README-ENV.md) | `VITE_*` variables and how the client reads them |
| [SETUP.md](./SETUP.md) | What `.env.local` must contain (placeholders only) |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Static site + Edge Functions outline (placeholders) |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Minimal local workflow |
| [CODEBASE_ARCHITECTURE.md](./CODEBASE_ARCHITECTURE.md) | Multi-page HTML roots, folder map |
| [DATABASE_ARCHITECTURE.md](./DATABASE_ARCHITECTURE.md) | Tables and RLS overview |
| [DASHBOARD_FUNCTIONS.md](./DASHBOARD_FUNCTIONS.md) | Dashboard sections by permission |
| [COPILOT_CONTEXT.md](./COPILOT_CONTEXT.md) | Long **AI / assistant** context for this codebase |
| [DOCS_CHANGELOG.md](./DOCS_CHANGELOG.md) | Doc changes (newest first) |
| [APPLYING_AND_APPLICATION_REVIEW.md](./APPLYING_AND_APPLICATION_REVIEW.md) | Application pipeline and emails |
| [ADDING_A_NEW_MEMBER.md](./ADDING_A_NEW_MEMBER.md) | Member creation flow |
| [FIRST_LOGIN_AND_REGISTRATION.md](./FIRST_LOGIN_AND_REGISTRATION.md) | First login, registration, and Forgot Password |
| [BILLS_EXEC_SUITE_SPEC.md](./BILLS_EXEC_SUITE_SPEC.md) | Bills exec suite (assignments, research, outreach) |
| [leave-and-extension-requests.md](./leave-and-extension-requests.md) | Leave / extension requests |

**Volunteer verification email:** `send-volunteer-verification` Edge Function + dashboard flow — see **COPILOT_CONTEXT.md** and `supabase/functions/send-volunteer-verification/`.

**Email HTML (scratch / design only):** [email-templates/](./email-templates/) — production bodies are in Edge Functions.

**Optional notes:** [MEMBER_MANAGEMENT_REFACTOR.md](./MEMBER_MANAGEMENT_REFACTOR.md) if present.

**Shipped-features narrative (repo root):** [../WORK_SUMMARY.txt](../WORK_SUMMARY.txt) — §0 *Current product overview (2026)*.
