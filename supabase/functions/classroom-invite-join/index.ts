import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const PRODUCTION_URL = (Deno.env.get("PRODUCTION_URL") ?? "https://spanationwide.org").replace(/\/$/, "")
const FROM_ADDRESS = "SPAN <contact@spanationwide.org>"
const LOGIN_URL = `${PRODUCTION_URL}/login.html?mode=classroom`

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function generateRandomPassword(length = 16) {
  const charset = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const array = new Uint32Array(length)
  crypto.getRandomValues(array)
  let password = ""
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length]
  }
  return password
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

async function sendTeacherInviteEmail({
  toEmail,
  toName,
  tempPassword,
  createdNewUser,
}: {
  toEmail: string
  toName: string
  tempPassword?: string
  createdNewUser: boolean
}) {
  if (!RESEND_API_KEY) {
    return { ok: false as const, reason: "missing_credentials" }
  }

  const passwordBlock = tempPassword
    ? `
      <div style="background:#fff3cd; border-left:4px solid #ffc107; padding:16px; margin:24px 0; border-radius:4px;">
        <p style="color:#1e2746; font-size:15px; margin:0 0 12px;"><strong>Temporary password</strong></p>
        <p style="color:#1e2746; font-size:18px; font-family:monospace; background:#fff; padding:12px; border-radius:4px; margin:0; text-align:center; font-weight:600; letter-spacing:1px;">
          ${escapeHtml(tempPassword)}
        </p>
        <p style="color:#856404; font-size:13px; margin:12px 0 0;">
          Use this once to sign in, then change it from Classroom if you like.
        </p>
      </div>`
    : `
      <p style="color:#1e2746; font-size:16px; line-height:1.6; margin:0 0 24px;">
        Use the password you already have for this email address.
      </p>`

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
            You've been added as a teacher on <strong>SPAN Classroom</strong>.
            ${createdNewUser ? "A login was created for you." : "Your existing login has been linked."}
          </p>
          ${passwordBlock}
          <ol style="color:#1e2746; font-size:16px; line-height:1.6; padding-left:20px;">
            <li style="margin-bottom:12px;">Open the login page and choose <strong>Classroom</strong>.</li>
            <li style="margin-bottom:12px;">Sign in with <strong>${escapeHtml(toEmail)}</strong>.</li>
            <li>Create a class and share the join code with students.</li>
          </ol>
          <p style="margin:28px 0 0;">
            <a href="${escapeHtml(LOGIN_URL)}" style="display:inline-block; background:#16213e; color:#fff; text-decoration:none; padding:12px 22px; border-radius:6px; font-weight:600;">
              Open Classroom login
            </a>
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
      subject: "Your SPAN Classroom teacher login",
      html,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("Resend classroom invite join failed", response.status, errorText)
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
      school_id?: string
      nces_id?: string
      school_name?: string
      school_city?: string
      school_state?: string
      school_contact_email?: string
      first_name?: string
      last_name?: string
      email?: string
    }
    const action = String(body.action ?? "validate").trim().toLowerCase()
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
      .from("classroom_invites")
      .select(
        "invite_id, token, kind, school_id, expires_at, revoked_at, use_count, classroom_schools(school_id, name, city, state, active)",
      )
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

    const schoolRel = (invite as {
      classroom_schools?: {
        school_id?: string
        name?: string
        city?: string | null
        state?: string | null
        active?: boolean
      } | null
    }).classroom_schools

    if (action === "validate") {
      const pinnedId = (invite.school_id as string | null) || schoolRel?.school_id || null
      let schools: Array<{ school_id: string; name: string; city: string | null; state: string | null }> = []
      if (pinnedId) {
        if (schoolRel?.active === false) {
          return new Response(JSON.stringify({ error: "This invite’s school is no longer active." }), {
            status: 410,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
        schools = [
          {
            school_id: pinnedId,
            name: schoolRel?.name || "School",
            city: schoolRel?.city ?? null,
            state: schoolRel?.state ?? null,
          },
        ]
      } else {
        const { data: schoolRows, error: schoolsErr } = await admin
          .from("classroom_schools")
          .select("school_id, name, city, state")
          .eq("active", true)
          .order("name")
        if (schoolsErr) {
          return new Response(JSON.stringify({ error: "Could not load schools", details: schoolsErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
        schools = (schoolRows || []).map((s) => ({
          school_id: s.school_id,
          name: s.name,
          city: s.city ?? null,
          state: s.state ?? null,
        }))
      }

      return new Response(
        JSON.stringify({
          ok: true,
          kind: invite.kind,
          expires_at: invite.expires_at,
          school_id: pinnedId,
          school_pinned: !!pinnedId,
          /** Open invites may add a school; pinned invites may not. */
          allow_new_school: !pinnedId,
          schools,
          school_name: schoolRel?.name ?? null,
          school_city: schoolRel?.city ?? null,
          school_state: schoolRel?.state ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    if (action !== "submit") {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const firstName = String(body.first_name ?? "").trim()
    const lastName = String(body.last_name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    if (!firstName || !lastName) {
      return new Response(JSON.stringify({ error: "First and last name are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "A valid school email is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // School: pinned invite → fixed id; else Classroom school_id OR NCES directory pick.
    const pinnedId = (invite.school_id as string | null) || schoolRel?.school_id || null
    const requestedSchoolId = String(body.school_id ?? "").trim() || null
    const ncesId = String(body.nces_id ?? "").trim()
    const newSchoolName = String(body.school_name ?? "").trim()
    const newSchoolCity = String(body.school_city ?? "").trim() || null
    const newSchoolState = String(body.school_state ?? "").trim() || null
    const newSchoolContact =
      String(body.school_contact_email ?? "").trim().toLowerCase() || email

    if (
      pinnedId &&
      (ncesId || newSchoolName || (requestedSchoolId && requestedSchoolId !== pinnedId))
    ) {
      return new Response(JSON.stringify({ error: "This invite is locked to a specific school." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let schoolId: string | null = pinnedId || requestedSchoolId
    let schoolName: string | null = schoolRel?.name ?? null
    let createdSchool = false

    if (!schoolId && ncesId) {
      if (!/^\d{12}$/.test(ncesId)) {
        return new Response(JSON.stringify({ error: "Invalid school directory selection." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      if (!newSchoolName) {
        return new Response(JSON.stringify({ error: "School name is required with directory selection." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const { data: byNces, error: ncesErr } = await admin
        .from("classroom_schools")
        .select("school_id, name, active")
        .eq("nces_id", ncesId)
        .maybeSingle()
      if (ncesErr) {
        return new Response(JSON.stringify({ error: "Could not check existing schools", details: ncesErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      if (byNces) {
        if (byNces.active === false) {
          await admin.from("classroom_schools").update({ active: true }).eq("school_id", byNces.school_id)
        }
        schoolId = byNces.school_id
        schoolName = byNces.name
      } else {
        // Also reuse same name+state if present without nces_id yet.
        let matchQuery = admin
          .from("classroom_schools")
          .select("school_id, name, active, nces_id")
          .ilike("name", newSchoolName)
          .eq("active", true)
          .limit(5)
        if (newSchoolState) matchQuery = matchQuery.ilike("state", newSchoolState)
        const { data: matches } = await matchQuery
        const exact = (matches || []).find(
          (s) => String(s.name || "").trim().toLowerCase() === newSchoolName.toLowerCase(),
        )
        if (exact) {
          schoolId = exact.school_id
          schoolName = exact.name
          if (!exact.nces_id) {
            await admin.from("classroom_schools").update({ nces_id: ncesId }).eq("school_id", exact.school_id)
          }
        } else {
          const { data: schoolRow, error: schoolInsErr } = await admin
            .from("classroom_schools")
            .insert({
              nces_id: ncesId,
              name: newSchoolName,
              city: newSchoolCity,
              state: newSchoolState,
              contact_email: isValidEmail(newSchoolContact) ? newSchoolContact : email,
              active: true,
            })
            .select("school_id, name")
            .single()
          if (schoolInsErr || !schoolRow) {
            return new Response(
              JSON.stringify({ error: "Could not create school", details: schoolInsErr?.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            )
          }
          schoolId = schoolRow.school_id
          schoolName = schoolRow.name
          createdSchool = true
        }
      }
    } else if (!schoolId && newSchoolName) {
      return new Response(
        JSON.stringify({
          error: "Select your school from the directory (state → city/search → school).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    } else if (schoolId) {
      if (pinnedId && schoolId !== pinnedId) {
        return new Response(JSON.stringify({ error: "This invite is locked to a different school." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const { data: schoolRow, error: schoolLookupErr } = await admin
        .from("classroom_schools")
        .select("school_id, name, active")
        .eq("school_id", schoolId)
        .maybeSingle()
      if (schoolLookupErr || !schoolRow || schoolRow.active === false) {
        return new Response(JSON.stringify({ error: "Selected school is not available." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      schoolName = schoolRow.name
    } else {
      return new Response(
        JSON.stringify({ error: "Select your school from the list, or add a new school." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const { data: existingTeacher } = await admin
      .from("classroom_teachers")
      .select("teacher_id")
      .eq("school_id", schoolId)
      .ilike("email", email)
      .maybeSingle()
    if (existingTeacher) {
      return new Response(
        JSON.stringify({ error: "A teacher with this email is already registered at this school." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const { data: teacher, error: teacherInsErr } = await admin
      .from("classroom_teachers")
      .insert({
        school_id: schoolId,
        first_name: firstName,
        last_name: lastName,
        email,
        active: true,
      })
      .select("teacher_id, first_name, last_name, email")
      .single()
    if (teacherInsErr || !teacher) {
      return new Response(
        JSON.stringify({ error: "Could not create teacher", details: teacherInsErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const displayName = `${firstName} ${lastName}`.trim()
    let userId: string | null = null
    let createdNewUser = false
    let tempPassword: string | undefined

    const existingAuth = await findAuthUserByEmail(admin, email)
    if (existingAuth) {
      userId = existingAuth.id
    } else {
      tempPassword = generateRandomPassword()
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          first_name: firstName,
          last_name: lastName,
          classroom_role: "teacher",
        },
      })
      if (createError || !created?.user) {
        console.error("createUser failed", createError)
        return new Response(
          JSON.stringify({ error: "Failed to create login", details: createError?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }
      userId = created.user.id
      createdNewUser = true
    }

    const { error: linkError } = await admin
      .from("classroom_teachers")
      .update({ user_id: userId, email })
      .eq("teacher_id", teacher.teacher_id)
    if (linkError) {
      return new Response(JSON.stringify({ error: "Failed to link teacher login" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const emailResult = await sendTeacherInviteEmail({
      toEmail: email,
      toName: displayName,
      tempPassword: createdNewUser ? tempPassword : undefined,
      createdNewUser,
    })

    await admin
      .from("classroom_invites")
      .update({
        use_count: Number(invite.use_count ?? 0) + 1,
        last_used_at: nowIso,
      })
      .eq("invite_id", invite.invite_id)

    const payload: Record<string, unknown> = {
      ok: true,
      teacher_id: teacher.teacher_id,
      school_id: schoolId,
      school_name: schoolName,
      email,
      created_school: createdSchool,
      created_new_user: createdNewUser,
      emailed: emailResult.ok,
      login_url: LOGIN_URL,
    }
    if (createdNewUser && tempPassword && !emailResult.ok) {
      payload.temp_password = tempPassword
      payload.email_error = emailResult.reason
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("classroom-invite-join error", err)
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
