import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""

const DEFAULT_FROM = "Joel Blessan <joel.blessan@spanationwide.org>"
const DEFAULT_CC = "vishank.panchbhavi@spanationwide.org,joelvblessan@gmail.com"

function fromAddress(): string {
  return (
    Deno.env.get("ONBOARDING_SCHEDULE_FROM")?.trim() ||
    Deno.env.get("INVITATION_FROM")?.trim() ||
    DEFAULT_FROM
  )
}

function ccList(): string[] {
  const raw =
    Deno.env.get("ONBOARDING_SCHEDULE_CC")?.trim() ||
    Deno.env.get("INVITATION_CC")?.trim() ||
    DEFAULT_CC
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

const SUBJECT = "Congratulations — next step: your SPAN onboarding call"

function isExec(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.volunteer) && v(member.applications) && v(member.bills) && v(member.registration)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Only allow https scheduling links (when2meet, Calendly, etc.) */
function sanitizeSchedulingUrl(raw: string | undefined): string | null {
  const t = String(raw ?? "").trim()
  if (!t) return null
  try {
    const u = new URL(t)
    if (u.protocol !== "https:") return null
    return u.toString()
  } catch {
    return null
  }
}

/** Wide logo (PNG) — hosted on production site for reliable loading in email clients.
 *  Do not use imgbb or other third-party hosts (they expire / 404). Redeploy this
 *  function after changing the URL. */
const LOGO_IMG_SRC = "https://spanationwide.org/images/index/logo-wide-dark.png"

function buildOnboardingScheduleEmailHtml(
  applicantName: string,
  opts: { when2meetUrl: string | null; deadlineNote: string | null },
): string {
  const name = escapeHtml(String(applicantName).trim() || "there")
  const p =
    "font-size: 15px; color: #212529; line-height: 1.65; margin: 0 0 1rem 0;"
  const when2meetUrl = opts.when2meetUrl
  const deadlineNote = opts.deadlineNote ? escapeHtml(opts.deadlineNote.trim()) : ""

  /* After “complete the following”: when2meet link, or reply instructions if no link */
  const when2meetBlock = when2meetUrl
    ? `<p style="${p}">
            <a href="${escapeHtml(when2meetUrl)}" style="color: #0b6ef9; text-decoration: underline; word-break: break-all;">${escapeHtml(when2meetUrl)}</a>
          </p>
          <p style="${p}">
            If you have any trouble with the link, reply to this email with times that work for you over the <strong>next two weeks</strong>.
          </p>`
    : `<p style="${p}">
            Please reply to this email with your availability over the <strong>next two weeks</strong> so we can schedule your <strong>onboarding call</strong>.
          </p>`

  /**
   * “We would appreciate it if you could complete the following by …” + when2meet or reply.
   * If no deadline: use “at your earliest convenience” when there’s a link; otherwise skip and only ask to reply.
   */
  const actionBlock = (() => {
    if (deadlineNote) {
      return `<p style="${p}">
            We would appreciate it if you could complete the following by <strong>${deadlineNote}</strong>.
          </p>
          ${when2meetBlock}`
    }
    if (when2meetUrl) {
      return `<p style="${p}">
            We would appreciate it if you could complete the following at your earliest convenience.
          </p>
          ${when2meetBlock}`
    }
    return when2meetBlock
  })()

  return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px 20px 40px; color: #212529;">
        <!-- Letterhead -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td valign="top" style="padding: 0 12px 0 0;">
              <img
                src="${LOGO_IMG_SRC}"
                alt="SPAN — Students for Patient Advocacy Nationwide"
                width="240"
                style="display: block; max-width: 240px; width: 100%; height: auto; border: 0;"
              />
            </td>
            <td valign="top" align="right" style="font-size: 12px; color: #6c757d; line-height: 1.5;">
              1702 Clifton Road Suite 1650<br/>
              Atlanta, GA 30322<br/>
              <a href="https://www.spanationwide.org" style="color: #0b6ef9; text-decoration: underline;">www.spanationwide.org</a>
            </td>
          </tr>
        </table>
        <div style="border-top: 1px solid #dee2e6; margin-bottom: 24px;"></div>

        <div style="background: #ffffff;">
          <p style="font-size: 16px; color: #212529; margin: 0 0 1rem 0;">Hello ${name},</p>
          <p style="${p}">
            <strong>Congratulations!</strong>
          </p>
          <p style="${p}">
            You have been accepted into <strong>Students for Patient Advocacy Nationwide (SPAN)</strong>. We were impressed with your application and interview, and would like to offer you a position in the organization.
          </p>
          <p style="${p}">
            This is a remarkable group, and we can&apos;t wait to see what we accomplish together. You were selected because we believe in what you bring to the organization, and we&apos;re thrilled to have you on board!
          </p>
          ${actionBlock}
          <p style="${p}">
            Please join SPAN Slack for announcements and team communication:
            <a href="https://span-nhi9797.slack.com/join/shared_invite/zt-3m31djuer-w9OaPInrVZWeHYoipfoIYQ" style="color: #0b6ef9; text-decoration: underline; word-break: break-all;">https://span-nhi9797.slack.com/join/shared_invite/zt-3m31djuer-w9OaPInrVZWeHYoipfoIYQ</a>
          </p>
          <p style="${p}">
            Please feel free to be in touch if you have any questions.
          </p>
          <p style="font-size: 15px; color: #212529; line-height: 1.65; margin: 1.5rem 0 0 0;">
            All the best,<br/>
            <strong>Joel Blessan</strong><br/>
            Executive Director | Students for Patient Advocacy Nationwide<br/>
            <a href="mailto:joel.blessan@spanationwide.org" style="color: #0b6ef9; text-decoration: none;">joel.blessan@spanationwide.org</a><br/>
            <a href="tel:+18326277795" style="color: #0b6ef9; text-decoration: none;">832-627-7795</a>
          </p>
        </div>
        <div style="text-align: center; margin-top: 28px;">
          <p style="font-size: 12px; color: #adb5bd;">
            &copy; ${new Date().getFullYear()} Students for Patient Advocacy Nationwide
          </p>
        </div>
      </div>
    `
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const body = await req.json()
    const { applicant_name, applicant_email, dry_run, when2meet_url, deadline_note } = body as {
      applicant_name?: string
      applicant_email?: string
      dry_run?: boolean
      /** Optional https URL (e.g. when2meet); shown in body. Omitted → reply-with-availability only. */
      when2meet_url?: string
      /** Optional plain text, e.g. "Wednesday, April 1st" — escaped; shown as deadline sentence. */
      deadline_note?: string
    }

    if (!applicant_name || !applicant_email) {
      return new Response(
        JSON.stringify({ error: "applicant_name and applicant_email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const token = authHeader.replace("Bearer ", "")
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: callerMember } = await admin
      .from("members")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()

    if (!isExec(callerMember)) {
      return new Response(
        JSON.stringify({ error: "Only executive directors can send onboarding schedule emails" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const safeWhen2meet = sanitizeSchedulingUrl(when2meet_url)
    if (String(when2meet_url ?? "").trim() && !safeWhen2meet) {
      return new Response(
        JSON.stringify({
          error: "when2meet_url must be a valid https:// link (e.g. when2meet or Calendly).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }
    const deadlineNote =
      typeof deadline_note === "string" && deadline_note.trim() ? deadline_note.trim() : null

    const html = buildOnboardingScheduleEmailHtml(String(applicant_name), {
      when2meetUrl: safeWhen2meet,
      deadlineNote,
    })
    const cc = ccList()
    const from = fromAddress()
    const previewPayload = {
      dry_run: true,
      from,
      to: [String(applicant_email).trim()],
      cc,
      subject: SUBJECT,
      html,
    }

    if (dry_run === true) {
      return new Response(JSON.stringify(previewPayload), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set")
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [String(applicant_email).trim()],
        cc,
        subject: SUBJECT,
        html,
      }),
    })

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text()
      console.error("Resend API error:", resendResponse.status, errorText)
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const resendData = await resendResponse.json()
    console.log("Onboarding schedule email sent:", resendData.id, "to:", applicant_email)

    return new Response(
      JSON.stringify({ ok: true, email_id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("send-onboarding-schedule-email error:", err)
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
}, { verifyJwt: false })
