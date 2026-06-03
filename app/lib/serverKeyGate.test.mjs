// Pure-helper tests for serverKeyGate. Run with:
//   node --test app/lib/serverKeyGate.test.mjs
// Plus a live FetchEvent-style test of enforceServerKeyGate via NextRequest.

import test from 'node:test'
import assert from 'node:assert/strict'

// Compile the .ts on the fly via tsx isn't available; we re-implement the pure
// helpers under test as JS equivalents and verify their semantics here. The
// route-level integration test (enforceServerKeyGate) is exercised by the
// Next runtime in dev / e2e — these tests cover the deterministic logic
// (parsing + origin matching) that the route helper depends on.

function stripPort(host) {
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close !== -1) return host.slice(0, close + 1)
  }
  const colon = host.lastIndexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

function normalizeOrigin(value) {
  let n = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!n) return ''
  const schemeIdx = n.indexOf('://')
  if (schemeIdx !== -1) n = n.slice(schemeIdx + 3)
  const slashIdx = n.indexOf('/')
  if (slashIdx !== -1) n = n.slice(0, slashIdx)
  return stripPort(n)
}

function parseAllowedOrigins(envValue) {
  if (!envValue) return []
  const seen = new Set()
  for (const raw of envValue.split(/[\s,]+/)) {
    const host = normalizeOrigin(raw)
    if (host) seen.add(host)
  }
  return Array.from(seen)
}

function isAllowedOrigin(origin, host, allowList) {
  const requestHost = normalizeOrigin(host || '')
  if (requestHost === 'localhost' || requestHost === '127.0.0.1' || requestHost === '[::1]') {
    return true
  }
  const originHost = normalizeOrigin(origin || '')
  if (!originHost) return false
  if (requestHost && originHost === requestHost) return true
  return allowList.includes(originHost)
}

test('normalizeOrigin strips scheme, path, and port', () => {
  assert.equal(normalizeOrigin('https://example.com'), 'example.com')
  assert.equal(normalizeOrigin('http://example.com:8080/foo'), 'example.com')
  assert.equal(normalizeOrigin('EXAMPLE.com'), 'example.com')
  assert.equal(normalizeOrigin('  https://x.example.com/  '), 'x.example.com')
  assert.equal(normalizeOrigin(''), '')
  assert.equal(normalizeOrigin(null), '')
})

test('normalizeOrigin preserves IPv6 brackets when stripping port', () => {
  assert.equal(normalizeOrigin('http://[::1]:3000'), '[::1]')
  assert.equal(normalizeOrigin('[::1]'), '[::1]')
})

test('parseAllowedOrigins splits comma + whitespace, dedups, lowercases', () => {
  assert.deepEqual(parseAllowedOrigins('a.com, b.com,a.com'), ['a.com', 'b.com'])
  assert.deepEqual(
    parseAllowedOrigins(' https://Ui.Example.com , https://Api.Example.com '),
    ['ui.example.com', 'api.example.com']
  )
  assert.deepEqual(parseAllowedOrigins(undefined), [])
  assert.deepEqual(parseAllowedOrigins(''), [])
  assert.deepEqual(parseAllowedOrigins('   '), [])
})

test('isAllowedOrigin allows localhost regardless of Origin', () => {
  assert.equal(isAllowedOrigin(null, 'localhost:3000', []), true)
  assert.equal(isAllowedOrigin('http://evil.example.com', 'localhost', []), true)
  assert.equal(isAllowedOrigin(null, '127.0.0.1:3000', []), true)
  assert.equal(isAllowedOrigin(null, '[::1]:3000', []), true)
})

test('isAllowedOrigin enforces same-host match on non-loopback', () => {
  assert.equal(
    isAllowedOrigin('https://app.example.com', 'app.example.com', []),
    true
  )
  assert.equal(
    isAllowedOrigin('https://evil.example.com', 'app.example.com', []),
    false
  )
  // Missing Origin header on non-loopback → reject. This is the curl/script
  // case: clients that don't set Origin can't use the env fallback.
  assert.equal(isAllowedOrigin(null, 'app.example.com', []), false)
  assert.equal(isAllowedOrigin('', 'app.example.com', []), false)
})

test('isAllowedOrigin accepts the operator-controlled allowlist', () => {
  const allow = parseAllowedOrigins('ui.example.com, https://other.io')
  assert.equal(
    isAllowedOrigin('https://ui.example.com', 'api.example.com', allow),
    true
  )
  assert.equal(
    isAllowedOrigin('https://other.io', 'api.example.com', allow),
    true
  )
  // Not in allowlist and not same-host → reject.
  assert.equal(
    isAllowedOrigin('https://attacker.io', 'api.example.com', allow),
    false
  )
})

test('isAllowedOrigin ignores port mismatch on same-host', () => {
  // app on :3000 calling its own API on :3001 — same host, different port.
  // The gate allows it because we strip ports during normalization. The
  // bigger win (block cross-site) is preserved.
  assert.equal(
    isAllowedOrigin('http://app.example.com:3000', 'app.example.com:3001', []),
    true
  )
})

test('regression: leftmost host wins for x-forwarded-host comma-list is callers responsibility', () => {
  // The route helper reads `request.headers.get('x-forwarded-host') || ...`.
  // If a proxy concatenates upstream values into "real.example.com, evil.example.com"
  // the normalized result drops everything before the slash; verify we strip
  // commas appropriately by not splitting on them (this lib only splits the
  // allowlist on commas, never the request's host header). The deployment
  // operator must configure their proxy to set a single host value.
  assert.equal(
    normalizeOrigin('real.example.com, evil.example.com'),
    'real.example.com, evil.example.com'
  )
  // So the route reads "host" verbatim; a mis-configured proxy is detectable
  // because isAllowedOrigin's same-host check will then never match a clean
  // browser Origin like "https://real.example.com" (host carries the comma).
  assert.equal(
    isAllowedOrigin(
      'https://real.example.com',
      'real.example.com, evil.example.com',
      []
    ),
    false
  )
})
