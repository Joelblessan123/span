import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

const MENTOR_EMAIL_DOMAIN = "mentors.spanationwide.org"

function isExec(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.volunteer) && v(member.applications) && v(member.bills) && v(member.registration)
}

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
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
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

    const body = (await req.json()) as {
      advisor_id?: string
      action?: string
    }
    const advisorId = String(body.advisor_id ?? "").trim()
    const action = String(body.action ?? "provision").trim().toLowerCase()
    if (!advisorId) {
      return new Response(JSON.stringify({ error: "advisor_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    if (action !== "provision" && action !== "reset_password") {
      return new Response(JSON.stringify({ error: "action must be provision or reset_password" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const token = authHeader.replace("Bearer ", "")
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token)
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
      return new Response(JSON.stringify({ error: "Only executive directors can provision mentor logins" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: advisor, error: advisorError } = await admin
      .from("advisors")
      .select("advisor_id, full_name, active")
      .eq("advisor_id", advisorId)
      .maybeSingle()

    if (advisorError || !advisor) {
      return new Response(JSON.stringify({ error: "Mentor not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: existingAccount } = await admin
      .from("mentor_accounts")
      .select("*")
      .eq("advisor_id", advisorId)
      .maybeSingle()

    if (action === "reset_password") {
      if (!existingAccount?.user_id || !existingAccount?.login_email) {
        return new Response(JSON.stringify({ error: "No login has been provisioned for this mentor yet" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const tempPassword = generateRandomPassword()
      const { error: updateAuthError } = await admin.auth.admin.updateUserById(existingAccount.user_id, {
        password: tempPassword,
        email_confirm: true,
      })
      if (updateAuthError) {
        return new Response(
          JSON.stringify({ error: "Failed to reset password", details: updateAuthError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
      }
      await admin
        .from("mentor_accounts")
        .update({
          active: true,
          provisioned_by: callerMember.member_id,
          provisioned_at: new Date().toISOString(),
        })
        .eq("mentor_account_id", existingAccount.mentor_account_id)

      return new Response(
        JSON.stringify({
          ok: true,
          action: "reset_password",
          advisor_id: advisorId,
          mentor_account_id: existingAccount.mentor_account_id,
          username: existingAccount.username,
          login_email: existingAccount.login_email,
          temp_password: tempPassword,
          full_name: advisor.full_name,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    // provision
    if (existingAccount?.user_id) {
      return new Response(
        JSON.stringify({
          error: "Login already exists for this mentor. Use reset_password to issue a new password.",
          username: existingAccount.username,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const base = slugifyName(String(advisor.full_name || "mentor"))
    let username = ""
    let loginEmail = ""
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = `${base}.${randomDigits(4)}`
      const email = `${candidate}@${MENTOR_EMAIL_DOMAIN}`
      const { data: clashUser } = await admin
        .from("mentor_accounts")
        .select("mentor_account_id")
        .eq("username", candidate)
        .maybeSingle()
      if (clashUser) continue
      const { data: clashEmail } = await admin
        .from("mentor_accounts")
        .select("mentor_account_id")
        .eq("login_email", email)
        .maybeSingle()
      if (clashEmail) continue
      const existingAuth = await findAuthUserByEmail(admin, email)
      if (existingAuth) continue
      username = candidate
      loginEmail = email
      break
    }

    if (!username || !loginEmail) {
      return new Response(JSON.stringify({ error: "Could not allocate a unique mentor username" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const tempPassword = generateRandomPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: loginEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        role: "mentor",
        advisor_id: advisorId,
        display_name: advisor.full_name,
        username,
      },
    })
    if (createError || !created?.user) {
      console.error("mentor createUser failed", createError)
      return new Response(
        JSON.stringify({ error: "Failed to create auth user", details: createError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const row = {
      advisor_id: advisorId,
      username,
      login_email: loginEmail,
      user_id: created.user.id,
      active: true,
      provisioned_by: callerMember.member_id,
      provisioned_at: new Date().toISOString(),
    }

    let mentorAccountId = existingAccount?.mentor_account_id
    if (existingAccount) {
      const { error: updErr } = await admin
        .from("mentor_accounts")
        .update(row)
        .eq("mentor_account_id", existingAccount.mentor_account_id)
      if (updErr) {
        await admin.auth.admin.deleteUser(created.user.id)
        return new Response(JSON.stringify({ error: "Failed to link mentor account", details: updErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("mentor_accounts")
        .insert(row)
        .select("mentor_account_id")
        .single()
      if (insErr || !inserted) {
        await admin.auth.admin.deleteUser(created.user.id)
        return new Response(JSON.stringify({ error: "Failed to create mentor account", details: insErr?.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      mentorAccountId = inserted.mentor_account_id
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action: "provision",
        advisor_id: advisorId,
        mentor_account_id: mentorAccountId,
        username,
        login_email: loginEmail,
        temp_password: tempPassword,
        full_name: advisor.full_name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("mentors-provision error", err)
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
