import { NextRequest, NextResponse } from 'next/server'

// Server-fallback key gate.
//
// The app is BYOK (Bring Your Own Key) by default — every API route reads
// `apiKey` from the request body and forwards it to OpenRouter. When that
// field is empty, the route can fall back to `process.env.OPENROUTER_API_KEY`,
// a feature the README documents for local dev and "hosting a demo where you
// want to provide the key for visitors".
//
// Without an origin check, that env-fallback also lets any third-party site
// or scripted client treat the deployment as a free OpenRouter proxy and
// silently drain the operator's credits — image generations on Gemini run
// roughly $0.03 a call, so an unbounded loop turns into real money fast.
// CWE-441 (Unintended Proxy / Confused Deputy).
//
// The gate below restricts env-fallback requests to the deployment's own
// origin by default, and to an operator-controlled allowlist when the demo
// is fronted by a separate domain. Client-supplied keys are not affected —
// the BYOK promise stays intact.

const TRUSTED_HEADER_HOST_PREFIX = ['x-forwarded-host'] as const

function lowercaseTrim(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function stripPort(host: string): string {
  // IPv6 brackets first: [::1]:3000 → [::1]
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close !== -1) return host.slice(0, close + 1)
  }
  const colon = host.lastIndexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

function normalizeOrigin(value: string): string {
  // Accept full origins (https://example.com), bare hosts (example.com), and
  // host:port pairs. Strip protocol + port so the allowlist comparison runs
  // on a canonical host string.
  let normalized = lowercaseTrim(value)
  if (!normalized) return ''
  // strip scheme
  const schemeIdx = normalized.indexOf('://')
  if (schemeIdx !== -1) normalized = normalized.slice(schemeIdx + 3)
  // strip path
  const slashIdx = normalized.indexOf('/')
  if (slashIdx !== -1) normalized = normalized.slice(0, slashIdx)
  // strip port
  normalized = stripPort(normalized)
  return normalized
}

/**
 * Parse the comma- or whitespace-separated ALLOWED_FALLBACK_ORIGINS env var
 * into a deduped, normalized host list. Empty / unset env returns [].
 */
export function parseAllowedOrigins(envValue: string | undefined): string[] {
  if (!envValue) return []
  const seen = new Set<string>()
  for (const raw of envValue.split(/[\s,]+/)) {
    const host = normalizeOrigin(raw)
    if (host) seen.add(host)
  }
  return Array.from(seen)
}

/**
 * Decide whether a request can use the server-side fallback key.
 *
 * - When `host` matches the request's own host (same-origin POST from the
 *   deployment), allow.
 * - When the `Origin` header is missing AND `Referer` is missing, this is
 *   almost always a scripted client (curl, fetch from a non-browser) — reject
 *   so the fallback isn't trivially scriptable.
 * - When the operator widened the allowlist via env, accept those origins
 *   too (covers split UI/API domain setups).
 *
 * Loopback hosts are always allowed so `npm run dev` keeps working.
 */
export function isAllowedOrigin(
  origin: string | null,
  host: string | null,
  allowList: string[]
): boolean {
  const requestHost = normalizeOrigin(host || '')
  if (requestHost === 'localhost' || requestHost === '127.0.0.1' || requestHost === '[::1]') {
    return true
  }
  const originHost = normalizeOrigin(origin || '')
  if (!originHost) return false
  if (requestHost && originHost === requestHost) return true
  return allowList.includes(originHost)
}

/**
 * Enforce the gate when the route is about to use the server-side env key.
 * Returns null when allowed, a 403 NextResponse when blocked.
 *
 * Call sites should invoke this ONLY when the client did not supply their own
 * API key — BYOK requests must remain unrestricted.
 */
export function enforceServerKeyGate(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin')
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host')
  const allowList = parseAllowedOrigins(process.env.ALLOWED_FALLBACK_ORIGINS)
  if (isAllowedOrigin(origin, host, allowList)) return null
  return NextResponse.json(
    {
      error:
        'Server-side OpenRouter key is restricted to same-origin requests. Add your own key in Settings, or ask the operator to widen ALLOWED_FALLBACK_ORIGINS.',
    },
    { status: 403 }
  )
}
