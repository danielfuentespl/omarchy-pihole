const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const Model = require('../Model.js')
const source = fs.readFileSync(require.resolve('../Service.qml'), 'utf8')
// Execute the production functions, not a second implementation of the state machine.
// Qt bindings, signal delivery, TLS and process destruction still need a runtime smoke test.
const functions = source.match(/^    function [\s\S]*?^    }/gm).join('\n')
const summary = fs.readFileSync(require.resolve('./fixtures/summary.json'), 'utf8')
const auth = fs.readFileSync(require.resolve('./fixtures/auth.json'), 'utf8')
let checks = 0
function test(name, fn) { fn(); checks++; }
function harness() {
  const requests = [], lookups = [], later = []
  const timer = () => ({ restart() {}, stop() {} })
  function XHR() { this.headers = {}; requests.push(this) }
  XHR.DONE = 4
  XHR.prototype.open = function(method, url) { this.method = method; this.url = url }
  XHR.prototype.setRequestHeader = function(k, v) { this.headers[k] = v }
  XHR.prototype.send = function(body) { this.body = body }
  XHR.prototype.abort = function() { this.aborted = true }
  XHR.prototype.reply = function(status, body = '') {
    this.status = status; this.responseText = body; this.readyState = 4; this.onreadystatechange()
  }
  const ctx = { Model, Date, XMLHttpRequest: XHR, Qt: { callLater(f) { later.push(f) } },
    requestTimeout: timer(), lookupTimeout: timer(), requestTimeoutMs: 5000,
    refreshIntervalSec: 60, root: null,
    lookupComponent: { createObject(root, props) {
      const l = { ...props, running: false, destroy() { this.destroyed = true } }
      lookups.push(l); return l
    } }
  }
  vm.createContext(ctx)
  for (const match of source.matchAll(/^    property \w+ (\w+): (.+)$/gm)) {
    ctx[match[1]] = vm.runInContext(match[2], ctx)
  }
  ctx.root = ctx
  vm.runInContext(functions, ctx)
  function configure(url = 'https://a.example', secretId = 'default') {
    ctx.settings = { baseUrl: url, secretId }; ctx.configurationChanged()
    while (later.length) later.shift()()
  }
  configure()
  return { s: ctx, requests, lookups, configure,
    reply(status, body) { requests.at(-1).reply(status, body) },
    secret(code = 0, value = 'synthetic-password') { ctx.finishSecretLookup(lookups.at(-1), code, value) } }
}
function login(h) { h.reply(401); h.secret(); h.reply(200, auth) }
function success(h) { h.reply(200, summary); h.reply(200, '{"blocking":"enabled"}') }
for (const phase of ['GET', 'lookup', 'auth']) {
  test('origin switch during ' + phase, () => {
    const h = harness()
    if (phase !== 'GET') h.reply(401)
    if (phase === 'auth') h.secret()
    const oldRequest = h.requests.at(-1), oldLookup = h.lookups.at(-1)
    h.configure('https://b.example')
    const count = h.requests.length
    oldRequest.reply(200, phase === 'auth' ? auth : summary)
    if (oldLookup) h.s.finishSecretLookup(oldLookup, 0, 'old-password')
    assert.equal(h.requests.length, count)
    assert.equal(h.requests.at(-1).url, 'https://b.example/api/stats/summary')
    assert.equal(h.requests.at(-1).headers['X-FTL-SID'], undefined)
    assert.equal(h.requests.at(-1).body, null)
    assert.equal(h.s.sid, '')
    assert.equal(h.s._secret, '')
    if (phase === 'lookup') assert.equal(oldLookup.destroyed, true)
    else assert.equal(oldRequest.aborted, true)
  })
}
test('Secret ID change during authentication', () => {
  const h = harness(); h.reply(401); h.secret()
  const old = h.requests.at(-1)
  h.configure('https://a.example', 'second')
  old.reply(200, auth)
  assert.equal(h.s.sid, '')
  h.reply(401)
  assert.equal(h.lookups.at(-1).cycle.secretId, 'second')
})
test('settings change before binding handler cannot complete old request', () => {
  const h = harness(); h.reply(401); h.secret()
  h.s.settings = { baseUrl: 'https://b.example' }
  h.reply(200, auth)
  assert.equal(h.s.sid, '')
  assert.equal(h.requests.length, 2)
  h.s.configurationChanged(); h.s.refresh()
  assert.equal(h.requests.at(-1).url, 'https://b.example/api/stats/summary')
})
test('401 -> auth -> summary/blocking, SID reuse', () => {
  const h = harness(); login(h); success(h)
  assert.equal(h.s.health, 'ok'); assert.equal(h.s.hasData, true)
  assert.equal(h.s.queriesTotal, 125304)
  assert.equal(h.requests[1].method, 'POST')
  assert.equal(h.requests[1].url, 'https://a.example/api/auth')
  assert.equal(JSON.parse(h.requests[1].body).password, 'synthetic-password')
  assert.equal(h.s._secret, ''); assert.equal(h.s._secretOutput, '')
  assert.equal(h.lookups[0].destroyed, true)
  h.s.refresh()
  assert.equal(h.requests.at(-1).headers['X-FTL-SID'], 'fixture-session-id')
  h.reply(200, summary); h.reply(200, '{"blocking":"disabled"}')
  assert.equal(h.s.health, 'warning')
})
test('SID A is discarded for B after successful login', () => {
  const h = harness(); login(h); success(h); h.configure('https://b.example')
  assert.equal(h.s.hasData, false); assert.equal(h.s.queriesTotal, 0)
  assert.equal(h.requests.at(-1).headers['X-FTL-SID'], undefined)
})
test('expired SID reauthenticates once', () => {
  const h = harness(); login(h); success(h); h.s.refresh(); h.reply(401)
  h.secret(); h.reply(200, auth); success(h)
  assert.equal(h.s.health, 'ok'); assert.equal(h.lookups.length, 2)
})
test('second 401 ends cycle', () => {
  const h = harness(); login(h); h.reply(401)
  assert.equal(h.s.health, 'auth'); assert.equal(h.s.refreshing, false)
  assert.equal(h.lookups.length, 1)
})
test('wrong password', () => {
  const h = harness(); h.reply(401); h.secret(); h.reply(401)
  assert.equal(h.s.health, 'auth'); assert.equal(h.s.sid, '')
})
for (const [code, out, health] of [[127, 'DO-NOT-DISPLAY', 'config'], [1, 'DO-NOT-DISPLAY', 'auth'], [0, '', 'auth']]) {
  test('lookup failure ' + code, () => {
    const h = harness(); h.reply(401); h.secret(code, out)
    assert.equal(h.s.health, health); assert.equal(h.s.refreshing, false)
    assert(!h.s.lastError.includes('DO-NOT-DISPLAY'))
    assert.equal(h.requests.length, 1)
  })
}
test('lookup timeout and late callback, recovery', () => {
  const h = harness(); h.reply(401); const old = h.lookups.at(-1)
  h.s.lookupTimedOut()
  assert.equal(old.running, false); assert.equal(old.destroyed, true)
  assert.equal(h.s.refreshing, false); assert.equal(h.s.health, 'offline')
  h.s.refresh(); const count = h.requests.length
  h.s.finishSecretLookup(old, 0, 'old-secret'); assert.equal(h.requests.length, count)
  success(h); assert.equal(h.s.health, 'ok')
})
test('XHR timeout ignores late callback', () => {
  const h = harness(), old = h.requests.at(-1)
  h.s.requestTimedOut(); h.s.refresh(); old.reply(200, summary)
  assert.equal(h.requests.length, 2); assert.equal(h.s.hasData, false)
  success(h); assert.equal(h.s.hasData, true)
})
test('partial/invalid results do not replace cached metrics', () => {
  const h = harness(); success(h); h.s.refresh(); h.reply(200, summary); h.reply(200, 'bad json')
  assert.equal(h.s.stale, true); assert.equal(h.s.hasData, true)
  assert.equal(h.s.queriesTotal, 125304); assert.equal(h.s.health, 'critical')
  h.s.refresh(); h.reply(0); assert.equal(h.s.health, 'offline')
})
test('polling setting change preserves session', () => {
  const h = harness(); login(h); success(h)
  h.s.settings = { baseUrl: 'https://a.example', secretId: 'default', refreshIntervalSec: 120 }
  h.s.configurationChanged(); assert.equal(h.s.sid, 'fixture-session-id')
})
test('401 at blocking restarts the whole authenticated snapshot', () => {
  const h = harness(); h.reply(200, summary); h.reply(401); h.secret(); h.reply(200, auth); success(h)
  assert.equal(h.s.hasData, true); assert.equal(h.lookups.length, 1)
})
test('invalid authentication response cannot become a SID', () => {
  const h = harness(); h.reply(401); h.secret(); h.reply(200, '{"session":{"valid":true,"sid":{},"validity":300}}')
  assert.equal(h.s.sid, ''); assert.equal(h.s.health, 'critical')
  assert.equal(h.s._secret, '')
})
test('invalid origin change cancels a pending lookup', () => {
  const h = harness(); h.reply(401); const old = h.lookups.at(-1)
  h.configure('https://b.example/admin')
  h.s.finishSecretLookup(old, 0, 'old-password')
  assert.equal(h.s.health, 'config'); assert.equal(h.requests.length, 1)
  assert.equal(h.s._secret, '')
})
console.log(`Service tests: OK (${checks} scenarios; simulated transport/process)`)
