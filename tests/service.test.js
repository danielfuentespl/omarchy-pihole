const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const Model = require('../Model.js')
const source = fs.readFileSync(require.resolve('../Service.qml'), 'utf8')
const functions = source.match(/^    function [\s\S]*?^    }/gm).join('\n')
const summary = fs.readFileSync(require.resolve('./fixtures/summary.json'), 'utf8')
const auth = fs.readFileSync(require.resolve('./fixtures/auth.json'), 'utf8')
let checks = 0
function test(name, fn) { fn(); checks++ }

function harness(url = 'https://a.example', secretId = 'default', caCertPath = '') {
  const requests = [], lookups = [], later = [], cancelled = []
  const timer = () => ({ restart() { this.active = true }, stop() { this.active = false } })
  const transport = {
    start(id, spec) { requests.push({ id, spec }); return true },
    cancel(id) { cancelled.push(id) }
  }
  const ctx = { Model, Date, Qt: { callLater(fn) { later.push(fn) } },
    requestTimeout: timer(), lookupTimeout: timer(), requestTimeoutMs: 5000,
    refreshIntervalSec: 60, root: null, curlTransport: transport,
    lookupComponent: { createObject(root, props) {
      const lookup = { ...props, running: true, destroy() { this.destroyed = true } }
      lookups.push(lookup)
      return lookup
    } }
  }
  vm.createContext(ctx)
  for (const match of source.matchAll(/^    property \w+ (\w+): (.+)$/gm)) {
    ctx[match[1]] = vm.runInContext(match[2], ctx)
  }
  ctx.root = ctx
  vm.runInContext(functions, ctx)
  function configure(nextUrl = url, nextSecretId = secretId, nextCa = caCertPath) {
    url = nextUrl; secretId = nextSecretId; caCertPath = nextCa
    ctx.settings = { baseUrl: url, secretId, caCertPath }
    ctx.secretId = secretId; ctx.caCertPath = caCertPath
    ctx.configurationChanged()
    while (later.length) later.shift()()
  }
  configure()
  return {
    s: ctx, requests, lookups, cancelled, configure,
    reply(status, body = '', errorKind = '', errorMessage = '') {
      const request = requests.at(-1)
      ctx.completeRequest(request.id, status, body, errorKind, errorMessage)
    },
    secret(exitCode = 0, value = 'synthetic-app-password', index = -1) {
      const lookup = lookups.at(index)
      ctx.finishSecretLookup(lookup, exitCode, value)
    }
  }
}

function runUnauthenticatedCycle(h) {
  h.reply(200, summary)
  assert.equal(h.requests.at(-1).spec.url, 'https://a.example/api/dns/blocking')
  h.reply(200, '{"blocking":"enabled"}')
}

test('GET summary and blocking work without authentication', () => {
  const h = harness(); runUnauthenticatedCycle(h)
  assert.equal(h.s.health, 'ok')
  assert.equal(h.s.queriesTotal, 125304)
  assert.equal(h.requests[0].spec.method, 'GET')
  assert.equal(h.requests[0].spec.sid, '')
})

test('401 over HTTP refuses before Secret Service lookup', () => {
  const h = harness('http://a.example'); h.reply(401)
  assert.equal(h.lookups.length, 0)
  assert.equal(h.s.health, 'auth')
  assert.match(h.s.lastError, /require HTTPS/)
})

test('401 -> Secret Service -> POST auth -> SID GET -> blocking GET', () => {
  const h = harness(); h.reply(401)
  assert.equal(h.lookups.length, 1)
  assert.equal(h.lookups[0].cycle.baseUrl, 'https://a.example')
  assert.equal(h.lookups[0].cycle.secretId, 'default')
  h.secret()
  const login = h.requests.at(-1)
  assert.equal(login.spec.method, 'POST')
  assert.equal(login.spec.url, 'https://a.example/api/auth')
  assert.equal(login.spec.sensitive, true)
  assert.equal(JSON.parse(login.spec.body).password, 'synthetic-app-password')
  assert.equal(login.spec.sid, '')
  assert.equal(h.s._secret, '')
  h.reply(200, auth)
  assert.equal(h.s.sid, 'fixture-session-id')
  assert.equal(h.requests.at(-1).spec.url, 'https://a.example/api/stats/summary')
  assert.equal(h.requests.at(-1).spec.sid, 'fixture-session-id')
  assert.equal(h.requests.at(-1).spec.sensitive, true)
  h.reply(200, summary)
  assert.equal(h.requests.at(-1).spec.url, 'https://a.example/api/dns/blocking')
  assert.equal(h.requests.at(-1).spec.sid, 'fixture-session-id')
  h.reply(200, '{"blocking":"enabled"}')
  assert.equal(h.s.health, 'ok')
  assert.equal(h.s.authenticated, true)
})

test('wrong application password produces AUTH ERROR', () => {
  const h = harness(); h.reply(401); h.secret(); h.reply(401)
  assert.equal(h.s.health, 'auth')
  assert.match(h.s.lastError, /rejected the stored application password/)
  assert.equal(h.s.sid, '')
})

test('second 401 after SID retry stops without another lookup', () => {
  const h = harness(); h.reply(401); h.secret(); h.reply(200, auth); h.reply(401)
  assert.equal(h.s.health, 'auth')
  assert.equal(h.lookups.length, 1)
  assert.equal(h.requests.length, 3)
  assert.equal(h.s.refreshing, false)
})

test('expired SID can be renewed once in a later refresh cycle', () => {
  const h = harness(); h.reply(401); h.secret(); h.reply(200, auth)
  h.reply(200, summary); h.reply(200, '{"blocking":"enabled"}')
  h.s.refresh()
  assert.equal(h.requests.at(-1).spec.sid, 'fixture-session-id')
  h.reply(401)
  assert.equal(h.lookups.length, 2)
  assert.equal(h.s._authRetried, true)
})

test('second 401 during the same blocking snapshot stops without another lookup', () => {
  const h = harness(); h.reply(401); h.secret(); h.reply(200, auth)
  h.reply(200, summary); h.reply(401)
  assert.equal(h.lookups.length, 1)
  assert.equal(h.s.sid, '')
  assert.equal(h.s.health, 'auth')
})

test('baseUrl change during authentication cancels process and discards late SID', () => {
  const h = harness(); h.reply(401); h.secret()
  const stale = h.requests.at(-1)
  h.configure('https://b.example')
  assert(h.cancelled.includes(stale.id))
  h.s.completeRequest(stale.id, 200, auth)
  assert.equal(h.s.sid, '')
  assert.equal(h.requests.at(-1).spec.url, 'https://b.example/api/stats/summary')
})

test('Secret ID change during auth POST discards its late SID', () => {
  const h = harness(); h.reply(401); h.secret()
  const stale = h.requests.at(-1)
  assert.equal(stale.spec.url, 'https://a.example/api/auth')
  h.configure('https://a.example', 'secondary')
  assert(h.cancelled.includes(stale.id))
  h.s.completeRequest(stale.id, 200, auth)
  assert.equal(h.s.sid, '')
  h.reply(401)
  assert.equal(h.lookups.at(-1).cycle.secretId, 'secondary')
})

test('secretId change during lookup discards old credential and uses new id', () => {
  const h = harness(); h.reply(401)
  const old = h.lookups.at(-1)
  h.configure('https://a.example', 'secondary')
  h.s.finishSecretLookup(old, 0, 'old-password')
  assert.equal(h.requests.at(-1).spec.url, 'https://a.example/api/stats/summary')
  h.reply(401)
  assert.equal(h.lookups.at(-1).cycle.secretId, 'secondary')
})

test('callback from previous generation cannot publish results', () => {
  const h = harness(); const stale = h.requests.at(-1)
  h.configure('https://b.example')
  const before = h.s.queriesTotal
  h.s.completeRequest(stale.id, 200, summary)
  assert.equal(h.s.queriesTotal, before)
  assert.equal(h.requests.at(-1).spec.url, 'https://b.example/api/stats/summary')
})

test('secret-tool missing, error and empty result never expose stdout', () => {
  for (const [code, value, kind] of [[-2, 'DO-NOT-DISPLAY', 'config'], [1, 'DO-NOT-DISPLAY', 'auth'], [0, '', 'auth']]) {
    const h = harness(); h.reply(401); h.secret(code, value)
    assert.equal(h.s.errorKind, kind)
    assert(!h.s.lastError.includes('DO-NOT-DISPLAY'))
    assert.equal(h.requests.length, 1)
  }
})

test('Secret Service lookup timeout destroys process and ignores late output', () => {
  const h = harness(); h.reply(401); const old = h.lookups.at(-1)
  h.s.lookupTimedOut()
  assert.equal(old.running, false)
  assert.equal(old.destroyed, true)
  h.s.finishSecretLookup(old, 0, 'late-password')
  assert.equal(h.requests.length, 1)
  assert.equal(h.s.health, 'offline')
})

test('HTTP request timeout cancels curl and ignores late response', () => {
  const h = harness(); const request = h.requests.at(-1)
  h.s.requestTimedOut()
  assert(h.cancelled.includes(request.id))
  h.s.completeRequest(request.id, 200, summary)
  assert.equal(h.s.hasData, false)
})

test('curl error codes produce controlled TLS and network messages', () => {
  const h = harness(); h.reply(0, '', 'tls', 'TLS certificate verification failed')
  assert.equal(h.s.health, 'offline')
  assert.equal(h.s.lastError, 'TLS certificate verification failed')
})

test('redirect status fails with canonical URL guidance', () => {
  const h = harness(); h.reply(307)
  assert.equal(h.s.health, 'critical')
  assert.match(h.s.lastError, /Redirect refused\. Configure the canonical Pi-hole URL/)
})

test('custom CA path is captured and sent as a transport option', () => {
  const h = harness('https://a.example', 'default', '/etc/ssl/my ca.pem')
  assert.equal(h.requests[0].spec.caCertPath, '/etc/ssl/my ca.pem')
})

console.log(`Service tests: OK (${checks} scenarios; fake process transport)`)
