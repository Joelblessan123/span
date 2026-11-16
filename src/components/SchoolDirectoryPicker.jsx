import React, { useEffect, useMemo, useState } from 'react'
import { fetchSchoolDirectory } from '../lib/classroom'
import { US_STATE_CODE_TO_NAME } from '../lib/usStateCanonical'

const US_STATE_OPTIONS = Object.values(US_STATE_CODE_TO_NAME)
  .filter((n) => n !== 'United States')
  .sort((a, b) => a.localeCompare(b))

/**
 * Deterministic school picker: state → load NCES directory → city / search → select.
 * onChange receives { nces_id, name, city, state } or null.
 */
export default function SchoolDirectoryPicker({
  value = null,
  onChange,
  idPrefix = 'sdp',
  disabled = false,
  required = true,
}) {
  const [stateName, setStateName] = useState('')
  const [city, setCity] = useState('')
  const [query, setQuery] = useState('')
  const [directory, setDirectory] = useState([])
  const [cities, setCities] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loadedState, setLoadedState] = useState('')

  useEffect(() => {
    if (!stateName) {
      setDirectory([])
      setCities([])
      setLoadedState('')
      setCity('')
      setQuery('')
      if (value) onChange?.(null)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const result = await fetchSchoolDirectory({ state: stateName })
        if (cancelled) return
        setDirectory(Array.isArray(result.schools) ? result.schools : [])
        setCities(Array.isArray(result.cities) ? result.cities : [])
        setLoadedState(stateName)
        setCity('')
        setQuery('')
        // Clear selection when region changes unless it still matches this state list.
        if (value?.nces_id) {
          const stillThere = (result.schools || []).some((s) => s.nces_id === value.nces_id)
          if (!stillThere) onChange?.(null)
        }
      } catch (err) {
        if (!cancelled) {
          setDirectory([])
          setCities([])
          setLoadedState('')
          setError(err.message || 'Could not load schools for this state.')
          onChange?.(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // Intentionally only when state region changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateName])

  const filtered = useMemo(() => {
    let list = directory
    if (city) {
      const cityLower = city.toLowerCase()
      list = list.filter((s) => (s.city || '').toLowerCase() === cityLower)
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q))
    }
    return list
  }, [directory, city, query])

  const selectedId = value?.nces_id || ''

  function handleSchoolSelect(ncesId) {
    if (!ncesId) {
      onChange?.(null)
      return
    }
    const match = directory.find((s) => s.nces_id === ncesId)
    if (!match) {
      onChange?.(null)
      return
    }
    onChange?.({
      nces_id: match.nces_id,
      name: match.name,
      city: match.city || null,
      // Prefer full state name from the region dropdown (matches existing Classroom rows).
      state: loadedState || stateName || match.state || null,
    })
  }

  return (
    <div className="school-directory-picker">
      <div className="mb-2">
        <label className="form-label" htmlFor={`${idPrefix}-state`}>
          State
        </label>
        <select
          id={`${idPrefix}-state`}
          className="form-select"
          required={required}
          disabled={disabled}
          value={stateName}
          onChange={(e) => setStateName(e.target.value)}
        >
          <option value="">Select state…</option>
          {US_STATE_OPTIONS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <p className="small text-muted mb-2">
          Loading schools in {stateName}… (first load for a state can take a few seconds)
        </p>
      )}
      {error && (
        <div className="alert alert-danger py-2 small" role="alert">
          {error}
        </div>
      )}

      {!loading && loadedState && (
        <>
          <div className="row g-2 mb-2">
            <div className="col-sm-6">
              <label className="form-label" htmlFor={`${idPrefix}-city`}>
                City
              </label>
              <select
                id={`${idPrefix}-city`}
                className="form-select"
                disabled={disabled}
                value={city}
                onChange={(e) => {
                  setCity(e.target.value)
                  onChange?.(null)
                }}
              >
                <option value="">All cities ({cities.length})</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-sm-6">
              <label className="form-label" htmlFor={`${idPrefix}-search`}>
                Search schools
              </label>
              <input
                id={`${idPrefix}-search`}
                type="search"
                className="form-control"
                disabled={disabled}
                value={query}
                placeholder="Type to filter…"
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mb-0">
            <label className="form-label" htmlFor={`${idPrefix}-school`}>
              School
            </label>
            <select
              id={`${idPrefix}-school`}
              className="form-select"
              required={required}
              disabled={disabled || filtered.length === 0}
              value={selectedId}
              onChange={(e) => handleSchoolSelect(e.target.value)}
            >
              <option value="">
                {filtered.length
                  ? `Select school (${filtered.length} shown)…`
                  : 'No schools match — adjust city or search'}
              </option>
              {filtered.slice(0, 2500).map((s) => (
                <option key={s.nces_id} value={s.nces_id}>
                  {s.city ? `${s.name} — ${s.city}` : s.name}
                </option>
              ))}
            </select>
            <small className="text-muted">
              US public schools (NCES). Pick from the list — names are not typed freehand.
            </small>
          </div>
        </>
      )}
    </div>
  )
}
