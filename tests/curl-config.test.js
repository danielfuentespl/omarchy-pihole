const assert = require('assert')
const CurlConfig = require('../CurlConfig.js')

let checks = 0
function test(name, fn) { fn(); checks++ }

const values = [
  'quote " and slash \\',
  'tab\there',
  'line\nfeed\rreturn\vvertical',
  'password-☃-á-中',
  '--location\nurl = "http://attacker.invalid"'
]
for (const value of values) {
  test('curl config quote roundtrip syntax: ' + JSON.stringify(value), () => {
    const quoted = CurlConfig.quoteConfigValue(value)
    assert(quoted.startsWith('"') && quoted.endsWith('"'))
    assert(!quoted.slice(1, -1).includes('\n'))
    assert(!quoted.slice(1, -1).includes('\r'))
  })
}

test('NUL cannot enter a config value', () => {
  assert.throws(() => CurlConfig.quoteConfigValue('bad\u0000value'), /NUL/)
})

test('sensitive request config rejects HTTP', () => {
  const result = CurlConfig.buildRequest({ url: 'http://pihole/api/auth', method: 'POST', sensitive: true }, 'FRAME=')
  assert.equal(result.ok, false)
  assert.match(result.error, /require HTTPS/)
})

test('request config has no redirect option and preserves TLS verification', () => {
  const result = CurlConfig.buildRequest({
    url: 'https://pihole/api/auth', method: 'POST', sensitive: true,
    body: JSON.stringify({ password: 'quote"slash\\snow☃' }),
    sid: '', caCertPath: '/tmp/my "private" ca\\root.pem', maxTimeSec: 5, connectTimeoutSec: 2
  }, 'FRAME=')
  assert.equal(result.ok, true)
  assert(result.text.includes('cacert = "/tmp/my \\"private\\" ca\\\\root.pem"'))
  assert(!/^location\s*=/mi.test(result.text))
  assert(!/insecure|verifyhost\s*=\s*false|verifypeer\s*=\s*false/i.test(result.text))
  assert(result.text.includes('request = "POST"'))
})

test('invalid SID line breaks are rejected', () => {
  const result = CurlConfig.buildRequest({ url: 'https://pihole/api/stats/summary', method: 'GET', sid: 'x\r\nlocation = true' }, 'FRAME=')
  assert.equal(result.ok, false)
})

test('URL line breaks are rejected', () => {
  const result = CurlConfig.buildRequest({ url: 'https://pihole/\nlocation = true', method: 'GET' }, 'FRAME=')
  assert.equal(result.ok, false)
})

test('request URLs cannot add credentials, queries, fragments or arbitrary paths', () => {
  for (const url of [
    'https://user:pass@pihole/api/auth',
    'https://pihole/api/auth?x=1',
    'https://pihole/api/auth#fragment',
    'https://pihole/admin/api/auth',
    'https://pihole/api/auth/extra'
  ]) {
    assert.equal(CurlConfig.buildRequest({ url, method: 'GET' }, 'FRAME=').ok, false, url)
  }
})

test('status framing uses the last sentinel and preserves JSON body', () => {
  const marker = 'FRAME='
  const body = '{"message":"x ' + marker + '999"}'
  const parsed = CurlConfig.parseOutput(body + '\n' + marker + '200\n', marker)
  assert.deepEqual(parsed, { ok: true, status: 200, body })
  assert.equal(CurlConfig.parseOutput('body', marker).ok, false)
})

test('reliable curl network and TLS codes map to controlled messages', () => {
  assert.equal(CurlConfig.errorForExitCode(6).kind, 'network')
  assert.equal(CurlConfig.errorForExitCode(7).kind, 'network')
  assert.equal(CurlConfig.errorForExitCode(28).kind, 'timeout')
  assert.equal(CurlConfig.errorForExitCode(60).kind, 'tls')
  assert.equal(CurlConfig.errorForExitCode(77).kind, 'config')
})

console.log(`Curl config tests: OK (${checks} scenarios)`)
