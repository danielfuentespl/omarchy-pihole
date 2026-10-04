const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Model = require('../Model.js')

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}

{
  const result = Model.normalizeBaseUrl(' https://pi.hole/ ')
  assert.deepStrictEqual(result, { ok: true, value: 'https://pi.hole' })
}

{
  const result = Model.normalizeBaseUrl('pi.hole')
  assert.strictEqual(result.ok, false)
}

{
  const result = Model.parseSummary(fixture('summary.json'))
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.data.queriesTotal, 125304)
  assert.strictEqual(result.data.queriesBlocked, 18523)
  assert.strictEqual(result.data.percentBlocked, 14.782)
  assert.strictEqual(result.data.clientsActive, 34)
  assert.strictEqual(result.data.domainsBlocked, 234567)
}

{
  const result = Model.parseBlocking(fixture('blocking-enabled.json'))
  assert.deepStrictEqual(result, { ok: true, blocking: true })
}

{
  const result = Model.parseBlocking(fixture('blocking-disabled.json'))
  assert.deepStrictEqual(result, { ok: true, blocking: false })
}

{
  const result = Model.parseAuth(fixture('auth.json'))
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.sid, 'fixture-session-id')
  assert.strictEqual(result.validity, 300)
}

assert.strictEqual(Model.healthFor(true, false, ''), 'ok')
assert.strictEqual(Model.healthFor(false, false, ''), 'warning')
assert.strictEqual(Model.healthFor(true, true, ''), 'stale')
assert.strictEqual(Model.healthFor(true, false, 'network'), 'offline')
assert.strictEqual(Model.healthFor(true, false, 'auth'), 'auth')

for (const url of ['', 'https://', 'ftp://example.org', 'https://u:p@example.org',
  'https://example.org?x=1', 'https://example.org#x', 'https://example.org/api',
  'https://example.org/admin/', 'https://example.org/path', 'https://example.org//',
  'https://example.org:0', 'https://example.org:65536', 'http://999.0.0.1',
  'http://127.1', 'http://[:::]', 'http://[1:2:3:4:5:6:7]', 'http://[1:2:3:4:5:6:7:8:9]',
  'http://-bad.example', 'http://a..example', 'http://[::ffff:999.0.0.1]']) {
  assert.equal(Model.normalizeBaseUrl(url).ok, false, url)
}
for (const url of ['https://example.org', 'http://localhost:8080/', 'https://203.0.113.7',
  'https://[2001:db8::1]:8443/', 'http://[::1]', 'http://[::]',
  'http://[1:2:3:4:5:6:7:8]', 'http://[::ffff:203.0.113.7]']) {
  assert.equal(Model.normalizeBaseUrl(url).ok, true, url)
}
for (const parse of [Model.parseSummary, Model.parseAuth, Model.parseBlocking]) {
  for (const body of ['{', '', 'null', '[]', '{}']) assert.equal(parse(body).ok, false)
}
const sample = JSON.parse(fixture('summary.json'))
for (const [group, key] of [['queries', 'total'], ['queries', 'blocked'], ['queries', 'percent_blocked'],
  ['clients', 'active'], ['clients', 'total'], ['gravity', 'domains_being_blocked']]) {
  for (const value of [undefined, null, '12', -1, {}]) {
    const body = JSON.parse(JSON.stringify(sample)); body[group][key] = value
    assert.equal(Model.parseSummary(JSON.stringify(body)).ok, false)
  }
}
for (const sid of [null, {}, [], 42, '', ' ', 'bad\\r\\nheader']) {
  assert.equal(Model.parseAuth(JSON.stringify({session: {valid: true, sid, validity: 300}})).ok, false)
}
for (const validity of [0, -1, '300', null]) {
  assert.equal(Model.parseAuth(JSON.stringify({session: {valid: true, sid: 'synthetic-sid', validity}})).ok, false)
}
for (const blocking of ['unknown', 'failed', true, false, null, {}]) {
  assert.equal(Model.parseBlocking(JSON.stringify({blocking})).ok, false)
}
assert.equal(Model.formatNumber(1234567), '1.234.567')
assert.equal(Model.formatNumber(0), '0')
assert.equal(Model.formatNumber(12.6), '13')
assert.equal(Model.formatNumber(NaN), '0')
assert.equal(Model.formatPercent(14.782), '14.8 %')
assert.equal(Model.formatPercent(Infinity), '0.0 %')
console.log('Model tests: OK')
