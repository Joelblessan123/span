import { serve } from "https://deno.land/std@0.203.0/http/server.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

/** Two-letter state → FIPS (Urban Institute CCD). */
const STATE_TO_FIPS: Record<string, number> = {
  AL: 1,
  AK: 2,
  AZ: 4,
  AR: 5,
  CA: 6,
  CO: 8,
  CT: 9,
  DE: 10,
  DC: 11,
  FL: 12,
  GA: 13,
  HI: 15,
  ID: 16,
  IL: 17,
  IN: 18,
  IA: 19,
  KS: 20,
  KY: 21,
  LA: 22,
  ME: 23,
  MD: 24,
  MA: 25,
  MI: 26,
  MN: 27,
  MS: 28,
  MO: 29,
  MT: 30,
  NE: 31,
  NV: 32,
  NH: 33,
  NJ: 34,
  NM: 35,
  NY: 36,
  NC: 37,
  ND: 38,
  OH: 39,
  OK: 40,
  OR: 41,
  PA: 42,
  RI: 44,
  SC: 45,
  SD: 46,
  TN: 47,
  TX: 48,
  UT: 49,
  VT: 50,
  VA: 51,
  WA: 53,
  WV: 54,
  WI: 55,
  WY: 56,
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
}

const CCD_YEAR = 2022
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

type DirectorySchool = {
  nces_id: string
  name: string
  city: string | null
  state: string
  school_level: number | null
}

type CacheEntry = { at: number; schools: DirectorySchool[]; cities: string[] }

const memoryCache = new Map<string, CacheEntry>()

function normalizeState(raw: string): string | null {
  const t = String(raw || "").trim()
  if (!t) return null
  const upper = t.toUpperCase()
  if (STATE_TO_FIPS[upper]) return upper
  const abbr = STATE_NAME_TO_ABBR[t.toLowerCase()]
  return abbr && STATE_TO_FIPS[abbr] ? abbr : null
}

async function fetchCcdState(fips: number): Promise<DirectorySchool[]> {
  const schools: DirectorySchool[] = []
  let page = 1
  const perPage = 10000
  while (page <= 20) {
    const url =
      `https://educationdata.urban.org/api/v1/schools/ccd/directory/${CCD_YEAR}/` +
      `?fips=${fips}&per_page=${perPage}&page=${page}`
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
    })
    if (!resp.ok) {
      throw new Error(`Directory upstream error (${resp.status})`)
    }
    const payload = await resp.json()
    const results = Array.isArray(payload?.results) ? payload.results : []
    for (const row of results) {
      // school_status: 1 = open
      if (row?.school_status != null && Number(row.school_status) !== 1) continue
      const ncesId = String(row?.ncessch || "").trim()
      const name = String(row?.school_name || "").trim()
      if (!ncesId || !name) continue
      const state = String(row?.state_location || row?.state_mailing || "").trim().toUpperCase()
      schools.push({
        nces_id: ncesId,
        name,
        city: String(row?.city_location || row?.city_mailing || "").trim() || null,
        state: state || "",
        school_level: row?.school_level != null ? Number(row.school_level) : null,
      })
    }
    if (!payload?.next || results.length === 0) break
    page += 1
  }

  // Prefer high schools, then middle, then others; alpha within level.
  schools.sort((a, b) => {
    const la = a.school_level === 3 ? 0 : a.school_level === 2 ? 1 : 2
    const lb = b.school_level === 3 ? 0 : b.school_level === 2 ? 1 : 2
    if (la !== lb) return la - lb
    return a.name.localeCompare(b.name)
  })
  return schools
}

function citiesFrom(schools: DirectorySchool[]): string[] {
  const set = new Set<string>()
  for (const s of schools) {
    if (s.city) set.add(s.city)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const stateAbbr = normalizeState(String(body.state ?? ""))
    if (!stateAbbr) {
      return new Response(JSON.stringify({ error: "Select a US state." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    const fips = STATE_TO_FIPS[stateAbbr]
    const cityFilter = String(body.city ?? "").trim()
    const q = String(body.q ?? "").trim().toLowerCase()

    const cached = memoryCache.get(stateAbbr)
    let schools: DirectorySchool[]
    let cities: string[]
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      schools = cached.schools
      cities = cached.cities
    } else {
      schools = await fetchCcdState(fips)
      cities = citiesFrom(schools)
      memoryCache.set(stateAbbr, { at: Date.now(), schools, cities })
    }

    let filtered = schools
    if (cityFilter) {
      const cityLower = cityFilter.toLowerCase()
      filtered = filtered.filter((s) => (s.city || "").toLowerCase() === cityLower)
    }
    if (q) {
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(q))
    }

    // Cap payload when returning an unfiltered full-state list to keep responses manageable.
    const MAX = 8000
    const truncated = filtered.length > MAX
    if (truncated) filtered = filtered.slice(0, MAX)

    return new Response(
      JSON.stringify({
        ok: true,
        state: stateAbbr,
        source: "nces_ccd",
        year: CCD_YEAR,
        cities,
        count: filtered.length,
        truncated,
        schools: filtered.map(({ nces_id, name, city, state, school_level }) => ({
          nces_id,
          name,
          city,
          state,
          school_level,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("classroom-school-directory error", err)
    return new Response(
      JSON.stringify({
        error: "Could not load school directory",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
