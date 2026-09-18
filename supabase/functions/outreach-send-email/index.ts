import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 8192
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j])
    }
  }
  return btoa(binary)
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""

const DEFAULT_FROM = "Joel Blessan <joel.blessan@spanationwide.org>"

/** Only proposal PDFs from our public storage bucket may be attached. */
const PROPOSALS_PUBLIC_PREFIX =
  "https://qujzohvrbfsouakzocps.supabase.co/storage/v1/object/public/proposals/"

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024

/** Comma-separated override; defaults to Joel + Vishank (reference copies + CC on direct outreach). */
function referenceLogRecipients(): string[] {
  const raw = Deno.env.get("OUTREACH_REFERENCE_RECIPIENTS")?.trim()
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => isValidEmail(s))
  }
  return ["joel.blessan@spanationwide.org", "vishank.panchbhavi@spanationwide.org"]
}

/** Leadership CC for primary sends; omits `to` if it matches (avoids duplicate with legislator). */
function leadershipCcForPrimary(toAddress: string): string[] {
  const t = toAddress.trim().toLowerCase()
  return referenceLogRecipients().filter((e) => e.toLowerCase() !== t)
}

function fromAddress(): string {
  return Deno.env.get("OUTREACH_FROM")?.trim() || Deno.env.get("INVITATION_FROM")?.trim() || DEFAULT_FROM
}

/** Prefer member.email; else first.last@spanationwide.org when first/last are present (matches src/lib/outreachEmail.js). */
function submitterSpanEmail(member: Record<string, unknown> | null): string {
  if (!member) return ""
  const direct = String(member.email ?? "").trim()
  if (direct && isValidEmail(direct)) return direct
  const f = String(member.first_name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
  const l = String(member.last_name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "")
  if (f && l) {
    const built = `${f}.${l}@spanationwide.org`
    return isValidEmail(built) ? built : ""
  }
  return ""
}

function submitterDisplayName(member: Record<string, unknown> | null): string {
  if (!member) return "SPAN"
  const n = `${String(member.first_name ?? "").trim()} ${String(member.last_name ?? "").trim()}`.trim()
  return n || "SPAN"
}

/** RFC 5322-style From for Resend: "Name" <addr@domain>. */
function formatFromHeader(displayName: string, email: string): string {
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const needsQuotes = /[",;<>\(\)\[\]:@]/.test(displayName) || displayName !== displayName.trim()
  const namePart = needsQuotes ? `"${escaped}"` : displayName
  return `${namePart} <${email}>`
}

/** Direct / reference outreach appears from the caller's SPAN address when derivable; else env default. */
function isExec(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.volunteer) && v(member.applications) && v(member.bills) && v(member.registration)
}

function hasBillsPermission(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.bills)
}

function canUseOutreachEmail(
  member: Record<string, unknown> | null,
  isMentor = false,
): boolean {
  return isExec(member) || hasBillsPermission(member) || isMentor
}

/** Direct / reference outreach appears from the caller's SPAN address when derivable; else env default. */
function outreachFromHeader(member: Record<string, unknown> | null, isMentor = false): string {
  if (isMentor) return fromAddress()
  const addr = submitterSpanEmail(member)
  if (!addr) return fromAddress()
  // Never send as a synthetic mentor domain (not a real mailbox).
  if (addr.toLowerCase().endsWith("@mentors.spanationwide.org")) return fromAddress()
  return formatFromHeader(submitterDisplayName(member), addr)
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function allowlistedAttachmentUrl(url: string): boolean {
  const t = url.trim()
  return t.startsWith(PROPOSALS_PUBLIC_PREFIX) && !t.includes("..") && /^https:\/\//i.test(t)
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
    const body = await req.json() as {
      to?: string
      subject?: string
      html?: string
      text?: string
      attachment_url?: string | null
      /** Client-generated PDF (e.g. personalized outreach letter). Prefer over attachment_url when set. */
      attachment_base64?: string | null
      attachment_filename?: string | null
      /** When set, sends to leadership only (Joel/Vishank) for webmail reference logging. */
      mode?: string
    }

    const mode = String(body.mode ?? "primary").trim()
    const to = String(body.to ?? "").trim()
    const subjectRaw = String(body.subject ?? "").trim()
    const html = String(body.html ?? "").trim()
    const text = body.text != null ? String(body.text) : ""
    const attachmentUrl = body.attachment_url != null ? String(body.attachment_url).trim() : ""
    const attachmentBase64 = body.attachment_base64 != null ? String(body.attachment_base64).trim() : ""
    const attachmentFilenameRaw =
      body.attachment_filename != null ? String(body.attachment_filename).trim() : ""

    if (mode !== "primary" && mode !== "reference_log") {
      return new Response(JSON.stringify({ error: "Invalid mode." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (mode === "primary" && (!to || !isValidEmail(to))) {
      return new Response(JSON.stringify({ error: "Valid recipient email (to) is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const subject =
      mode === "reference_log"
        ? subjectRaw.startsWith("[Outreach reference]")
          ? subjectRaw
          : `[Outreach reference] ${subjectRaw}`
        : subjectRaw

    if (!subject || subject.length > 550) {
      return new Response(JSON.stringify({ error: "Subject is required (max ~550 chars, including reference prefix)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (!html || html.length > 400_000) {
      return new Response(JSON.stringify({ error: "HTML body is required (max size exceeded)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
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

    let isMentor = false
    if (!callerMember) {
      const { data: mentorRow } = await admin
        .from("mentor_accounts")
        .select("mentor_account_id")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle()
      isMentor = !!mentorRow
    }

    // Mentors may preview compose UI client-side but must not send on SPAN's behalf.
    if (isMentor) {
      return new Response(
        JSON.stringify({
          error: "Mentor accounts can preview outreach but cannot send email on SPAN's behalf",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    if (!canUseOutreachEmail(callerMember, false)) {
      return new Response(
        JSON.stringify({ error: "Bills permission required to send outreach emails" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const from = outreachFromHeader(callerMember, false)

    const recipients =
      mode === "reference_log" ? referenceLogRecipients() : [to]

    if (mode === "reference_log" && recipients.length === 0) {
      return new Response(JSON.stringify({ error: "Reference recipients are not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    type Attachment = { filename: string; content: string }
    let attachments: Attachment[] | undefined

    if (attachmentBase64) {
      const raw = attachmentBase64.replace(/^data:application\/pdf;base64,/i, "")
      if (!/^[A-Za-z0-9+/=\s]+$/.test(raw) || raw.length < 64) {
        return new Response(JSON.stringify({ error: "Invalid PDF attachment data." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      // Rough size check: base64 is ~4/3 of bytes
      const approxBytes = Math.floor((raw.replace(/\s/g, "").length * 3) / 4)
      if (approxBytes > MAX_ATTACHMENT_BYTES) {
        return new Response(JSON.stringify({ error: "PDF is too large to attach." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      let headerOk = false
      try {
        const head = atob(raw.replace(/\s/g, "").slice(0, 32))
        headerOk = head.startsWith("%PDF")
      } catch {
        headerOk = false
      }
      if (!headerOk) {
        return new Response(JSON.stringify({ error: "Attachment must be a PDF." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const safeName = attachmentFilenameRaw
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 120)
      const filename =
        safeName && safeName.toLowerCase().endsWith(".pdf")
          ? safeName
          : safeName
            ? `${safeName}.pdf`
            : "SPAN_outreach_letter.pdf"
      attachments = [{ filename, content: raw.replace(/\s/g, "") }]
    } else if (attachmentUrl) {
      if (!allowlistedAttachmentUrl(attachmentUrl)) {
        return new Response(
          JSON.stringify({ error: "Attachment URL must be a public proposals PDF on SPAN storage." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }
      const pdfRes = await fetch(attachmentUrl)
      if (!pdfRes.ok) {
        return new Response(
          JSON.stringify({ error: "Could not download PDF for attachment." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }
      const buf = new Uint8Array(await pdfRes.arrayBuffer())
      if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
        return new Response(JSON.stringify({ error: "PDF is too large to attach." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const content = uint8ToBase64(buf)
      const namePart = attachmentUrl.split("/").pop() || "proposal.pdf"
      const filename = namePart.endsWith(".pdf") ? namePart : `${namePart}.pdf`
      attachments = [{ filename, content }]
    }

    const resendBody: Record<string, unknown> = {
      from,
      to: recipients,
      subject,
      html,
    }
    if (mode === "primary") {
      const cc = leadershipCcForPrimary(to)
      if (cc.length) {
        resendBody.cc = cc
      }
    }
    if (text.trim()) {
      resendBody.text = text
    }
    if (attachments) {
      resendBody.attachments = attachments
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    })

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text()
      console.error("Resend outreach error:", resendResponse.status, errorText)
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const resendData = await resendResponse.json()
    const ccLog = mode === "primary" && Array.isArray(resendBody.cc) ? (resendBody.cc as string[]).join(",") : ""
    console.log(
      "Outreach email sent:",
      resendData.id,
      "mode:",
      mode,
      "to:",
      recipients.join(","),
      ccLog ? `cc:${ccLog}` : "",
    )

    return new Response(
      JSON.stringify({ ok: true, email_id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("outreach-send-email error:", err)
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
}, { verifyJwt: false })
