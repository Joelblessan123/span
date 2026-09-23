import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { decode as decodeBase64 } from "https://deno.land/std@0.203.0/encoding/base64.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const PRODUCTION_URL = (Deno.env.get("PRODUCTION_URL") ?? "https://spanationwide.org").replace(/\/$/, "")
const FROM_ADDRESS = Deno.env.get("MENTOR_JOIN_FROM")?.trim() || "SPAN <contact@spanationwide.org>"
const LOGIN_URL = `${PRODUCTION_URL}/login.html?mode=mentor`

const MAX_PHOTO_BYTES = 5 * 1024 * 1024

function generateRandomPassword(length = 14) {
  const charset = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const array = new Uint32Array(length)
  crypto.getRandomValues(array)
  let password = ""
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length]
  }
  return password
}

function slugifyName(fullName: string): string {
  const slug = fullName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.+/g, ".")
    .slice(0, 40)
  return slug || "mentor"
}

function randomDigits(n = 4): string {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  const max = 10 ** n
  return String(array[0] % max).padStart(n, "0")
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; email?: string | null } | null> {
  const target = email.toLowerCase().trim()
  let page = 1
  const perPage = 1000
  while (page <= 20) {
    const { data: userList, error: listError } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    })
    if (listError) throw listError
    const found = userList.users.find((u) => (u.email ?? "").toLowerCase() === target)
    if (found) return found
    if (!userList.users.length || userList.users.length < perPage) break
    page++
  }
  return null
}

async function sendMentorWelcomeEmail({
  toEmail,
  toName,
  username,
  tempPassword,
}: {
  toEmail: string
  toName: string
  username: string
  tempPassword: string
}) {
  if (!RESEND_API_KEY) {
    return { ok: false as const, reason: "missing_credentials" }
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0; padding:0; background:#f5f7fb; font-family:Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb; padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:12px; overflow:hidden;">
        <tr><td style="padding:40px 48px;">
          <p style="color:#1e2746; font-size:16px; margin:0 0 16px;">Hi ${escapeHtml(toName)},</p>
          <p style="color:#1e2746; font-size:16px; line-height:1.6; margin:0 0 16px;">
            Thank you for joining <strong>SPAN</strong> as a Board Mentor. Your profile is live and your dashboard login is ready.
          </p>
          <div style="background:#f8f9fa; border-left:4px solid #16213e; padding:16px; margin:24px 0; border-radius:4px;">
            <p style="color:#1e2746; font-size:14px; margin:0 0 8px;"><strong>Username</strong></p>
            <p style="color:#1e2746; font-size:18px; font-family:monospace; margin:0 0 16px;">${escapeHtml(username)}</p>
            <p style="color:#1e2746; font-size:14px; margin:0 0 8px;"><strong>Temporary password</strong></p>
            <p style="color:#1e2746; font-size:18px; font-family:monospace; margin:0;">${escapeHtml(tempPassword)}</p>
          </div>
          <ol style="color:#1e2746; font-size:16px; line-height:1.6; padding-left:20px;">
            <li style="margin-bottom:12px;">Open the login page and choose <strong>Mentor</strong>.</li>
            <li style="margin-bottom:12px;">Sign in with your username (or this email) and the temporary password.</li>
            <li>You can change your password from the dashboard.</li>
          </ol>
          <p style="margin:28px 0 0;">
            <a href="${escapeHtml(LOGIN_URL)}" style="display:inline-block; background:#16213e; color:#fff; text-decoration:none; padding:12px 22px; border-radius:6px; font-weight:600;">
              Open Mentor login
            </a>
          </p>
          <p style="color:#6c757d; font-size:13px; margin:28px 0 0;">
            Questions? Reply to this email or contact the SPAN executive team.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [toEmail],
      subject: "Welcome to SPAN — your mentor login",
      html,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("Resend mentor welcome failed", response.status, errorText)
    return { ok: false as const, reason: "send_failed", details: errorText }
  }
  return { ok: true as const }
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
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = (await req.json()) as {
      action?: string
      invite?: string
      full_name?: string
      email?: string
      phone?: string
      title?: string
      company?: string
      linkedin_url?: string
      photo_base64?: string
      photo_content_type?: string
      photo_filename?: string
    }

    const action = String(body.action ?? "submit").trim().toLowerCase()
    const inviteToken = String(body.invite ?? "").trim()
    if (!inviteToken) {
      return new Response(JSON.stringify({ error: "invite token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const nowIso = new Date().toISOString()
    const { data: invite, error: inviteErr } = await admin
      .from("mentor_invites")
      .select("*")
      .eq("token", inviteToken)
      .maybeSingle()

    if (inviteErr || !invite) {
      return new Response(JSON.stringify({ error: "Invalid or expired invite link" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (invite.revoked_at || invite.expires_at <= nowIso) {
      return new Response(JSON.stringify({ error: "This invite link has expired. Ask SPAN for a new one." }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (action === "validate") {
      return new Response(
        JSON.stringify({
          ok: true,
          expires_at: invite.expires_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const fullName = String(body.full_name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const phone = String(body.phone ?? "").trim()
    const title = String(body.title ?? "").trim()
    const company = String(body.company ?? "").trim()
    const linkedinUrl = String(body.linkedin_url ?? "").trim()
    const photoBase64 = String(body.photo_base64 ?? "").trim()
    const photoContentType = String(body.photo_content_type ?? "image/jpeg").trim().toLowerCase()
    const photoFilenameRaw = String(body.photo_filename ?? "photo.jpg").trim()

    if (!fullName || !email || !phone || !photoBase64) {
      return new Response(
        JSON.stringify({ error: "full_name, email, phone, and photo are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Enter a valid email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(photoContentType)) {
      return new Response(JSON.stringify({ error: "Photo must be JPEG, PNG, or WebP" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: emailClash } = await admin
      .from("advisors")
      .select("advisor_id")
      .ilike("email", email)
      .maybeSingle()
    if (emailClash) {
      return new Response(JSON.stringify({ error: "A mentor profile with this email already exists." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const existingAuth = await findAuthUserByEmail(admin, email)
    if (existingAuth) {
      return new Response(
        JSON.stringify({
          error: "This email already has a SPAN login. Contact SPAN if you need mentor access linked.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    let photoBytes: Uint8Array
    try {
      const cleaned = photoBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "")
      photoBytes = decodeBase64(cleaned)
    } catch {
      return new Response(JSON.stringify({ error: "Invalid photo data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (photoBytes.byteLength > MAX_PHOTO_BYTES) {
      return new Response(JSON.stringify({ error: "Photo must be under 5 MB" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const ext =
      photoContentType.includes("png")
        ? "png"
        : photoContentType.includes("webp")
          ? "webp"
          : "jpg"
    const safeBase = photoFilenameRaw.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || "photo"
    const storageName = `${crypto.randomUUID()}-${safeBase}.${ext}`.replace(/\.+/g, ".")

    const { error: uploadErr } = await admin.storage
      .from("advisors-images")
      .upload(storageName, photoBytes, {
        contentType: photoContentType === "image/jpg" ? "image/jpeg" : photoContentType,
        upsert: false,
      })
    if (uploadErr) {
      console.error("advisor photo upload failed", uploadErr)
      return new Response(JSON.stringify({ error: "Failed to upload photo", details: uploadErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: maxOrderRow } = await admin
      .from("advisors")
      .select("display_order")
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = Number(maxOrderRow?.display_order ?? 0) + 1

    const { data: advisor, error: advisorErr } = await admin
      .from("advisors")
      .insert({
        full_name: fullName,
        title: title || null,
        company: company || null,
        linkedin_url: linkedinUrl || null,
        photo: storageName,
        email,
        phone: phone || null,
        active: true,
        display_order: nextOrder,
      })
      .select("advisor_id, full_name")
      .single()

    if (advisorErr || !advisor) {
      await admin.storage.from("advisors-images").remove([storageName])
      return new Response(JSON.stringify({ error: "Failed to create mentor profile", details: advisorErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const base = slugifyName(fullName)
    let username = ""
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = `${base}.${randomDigits(4)}`
      const { data: clash } = await admin
        .from("mentor_accounts")
        .select("mentor_account_id")
        .eq("username", candidate)
        .maybeSingle()
      if (!clash) {
        username = candidate
        break
      }
    }
    if (!username) {
      return new Response(JSON.stringify({ error: "Could not allocate a unique username" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const tempPassword = generateRandomPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: "mentor",
        advisor_id: advisor.advisor_id,
        display_name: fullName,
        username,
      },
    })
    if (createError || !created?.user) {
      await admin.from("advisors").delete().eq("advisor_id", advisor.advisor_id)
      await admin.storage.from("advisors-images").remove([storageName])
      return new Response(JSON.stringify({ error: "Failed to create login", details: createError?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { error: accountErr } = await admin.from("mentor_accounts").insert({
      advisor_id: advisor.advisor_id,
      username,
      login_email: email,
      user_id: created.user.id,
      active: true,
      provisioned_by: invite.created_by,
      provisioned_at: new Date().toISOString(),
    })
    if (accountErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      await admin.from("advisors").delete().eq("advisor_id", advisor.advisor_id)
      await admin.storage.from("advisors-images").remove([storageName])
      return new Response(JSON.stringify({ error: "Failed to link mentor login", details: accountErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    await admin
      .from("mentor_invites")
      .update({
        last_used_at: new Date().toISOString(),
        use_count: Number(invite.use_count ?? 0) + 1,
      })
      .eq("invite_id", invite.invite_id)

    const emailResult = await sendMentorWelcomeEmail({
      toEmail: email,
      toName: fullName.split(/\s+/)[0] || fullName,
      username,
      tempPassword,
    })

    return new Response(
      JSON.stringify({
        ok: true,
        advisor_id: advisor.advisor_id,
        username,
        emailed: emailResult.ok,
        login_url: LOGIN_URL,
        // Only surface password if email failed so they can still proceed.
        ...(emailResult.ok ? {} : { temp_password: tempPassword, email_error: emailResult.reason }),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("mentors-join error", err)
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
