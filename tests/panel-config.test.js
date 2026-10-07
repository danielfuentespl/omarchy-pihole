const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const Model = require('../Model.js')

const source = fs.readFileSync(require.resolve('../Panel.qml'), 'utf8')
const match = source.match(/^    function saveBaseUrl\(\) \{[\s\S]*?^    \}/m)
assert(match, 'saveBaseUrl function should exist')

let checks = 0
function test(name, fn) { fn(); checks++ }

function harness({ settings = {}, saveResult = true, api = true } = {}) {
  const writes = []
  let refreshes = 0
  const ctx = {
    Model,
    moduleName: 'com.blogvirtualizado.omaops.pihole',
    settings,
    urlInput: { text: ' https://Pi.Hole/ ', forceActiveFocus() {}, selectAll() {} },
    configMessage: '',
    configEditing: true,
    service: { refresh() { refreshes++ } },
    setting(name, fallback) { return settings[name] ?? fallback },
    bar: api ? { shell: { updateEntryInline(id, entry) {
      writes.push({ id, entry })
      return saveResult
    } } } : null,
    root: null,
  }
  ctx.root = ctx
  vm.createContext(ctx)
  vm.runInContext(match[0], ctx)
  return { ctx, writes, get refreshes() { return refreshes } }
}

test('valid origin saves through Omarchy API and preserves other widget settings', () => {
  const h = harness({ settings: { id: 'ignored', secretId: 'secondary', caCertPath: '/tmp/ca.pem' } })
  h.ctx.saveBaseUrl()
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].id, 'com.blogvirtualizado.omaops.pihole')
  assert.deepEqual({ ...h.writes[0].entry }, {
    id: 'com.blogvirtualizado.omaops.pihole',
    secretId: 'secondary',
    caCertPath: '/tmp/ca.pem',
    baseUrl: 'https://pi.hole',
  })
  assert.equal(h.ctx.settings.baseUrl, 'https://pi.hole')
  assert.equal(h.ctx.configEditing, false)
  assert.equal(h.refreshes, 1)
})

test('invalid origin is rejected before persistence', () => {
  const h = harness()
  h.ctx.urlInput.text = 'https://pihole/admin'
  h.ctx.saveBaseUrl()
  assert.equal(h.writes.length, 0)
  assert.match(h.ctx.configMessage, /origin only/)
  assert.equal(h.ctx.configEditing, true)
  assert.equal(h.refreshes, 0)
})

test('missing Omarchy settings API reports a clear error', () => {
  const h = harness({ api: false })
  h.ctx.saveBaseUrl()
  assert.match(h.ctx.configMessage, /cannot save widget settings/)
  assert.equal(h.ctx.settings.baseUrl, undefined)
  assert.equal(h.refreshes, 0)
})

test('already-saved address is accepted when host reports no change', () => {
  const h = harness({ settings: { baseUrl: 'https://pi.hole' }, saveResult: false })
  h.ctx.saveBaseUrl()
  assert.equal(h.ctx.configMessage, '')
  assert.equal(h.ctx.configEditing, false)
  assert.equal(h.refreshes, 1)
})

console.log(`Panel config tests: OK (${checks} scenarios)`)
