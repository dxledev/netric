import test from 'node:test'
import assert from 'node:assert/strict'
import { startAppUpdateChecks } from './appUpdates.js'

class EventTargetMock {
  listeners = new Map()

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function makeHarness({ manifest = { buildId: 'build-a' }, fields = [], storage, href } = {}) {
  const win = new EventTargetMock()
  const doc = new EventTargetMock()
  doc.visibilityState = 'visible'
  doc.querySelectorAll = () => fields
  let reloads = 0
  const replacements = []
  win.location = {
    href: href ?? 'https://example.test/app?keep=1#section',
    reload: () => { reloads += 1 },
    replace: (url) => { replacements.push(url) },
  }
  const historyReplacements = []
  win.history = {
    state: { route: 'dashboard' },
    replaceState: (...args) => { historyReplacements.push(args) },
  }
  const session = storage ?? new MapStorage()
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => manifest }
  }
  const timers = {
    setTimeout: (callback) => setTimeout(callback, 60_000),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (callback) => setInterval(callback, 60_000),
    clearInterval: (id) => clearInterval(id),
  }
  return {
    win, doc, session, calls, timers, replacements, historyReplacements,
    fetch,
    get reloads() { return reloads },
    start: (buildId = 'build-a', extra = {}) => startAppUpdateChecks(buildId, {
      window: win,
      document: doc,
      sessionStorage: session,
      fetch,
      timers,
      ...extra,
    }),
  }
}

class MapStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
}

const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve))
}

test('current manifest leaves the running page alone and uses a fresh request', async () => {
  const h = makeHarness()
  const stop = h.start()
  await settle()
  assert.equal(h.reloads, 0)
  assert.match(h.calls[0].url, /^\/version\.json\?t=\d+$/)
  assert.equal(h.calls[0].init.cache, 'no-store')
  assert.equal(h.calls[0].init.credentials, 'same-origin')
  stop()
})

test('a changed manifest reloads once and preserves local storage', async () => {
  const localStorage = new MapStorage()
  localStorage.setItem('favorite', 'yes')
  const h = makeHarness({ manifest: { buildId: 'build-b' } })
  const stop = h.start('build-a', { localStorage })
  await settle()
  assert.equal(h.reloads, 1)
  assert.equal(localStorage.getItem('favorite'), 'yes')
  stop()
})

test('focus, BFCache pageshow, and visible state trigger checks', async () => {
  const h = makeHarness()
  const stop = h.start()
  await settle()
  h.win.dispatch('focus')
  await settle()
  h.win.dispatch('pageshow')
  await settle()
  h.doc.dispatch('visibilitychange')
  await settle()
  assert.equal(h.calls.length, 4)
  stop()
})

test('offline and malformed manifest responses do not reload', async () => {
  const h = makeHarness()
  h.fetch = async () => { throw new Error('offline') }
  const stop = h.start('build-a', { fetch: h.fetch })
  await settle()
  assert.equal(h.reloads, 0)
  stop()

  const bad = makeHarness()
  bad.fetch = async () => ({ ok: true, json: async () => ({ buildId: '' }) })
  const stopBad = bad.start('build-a', { fetch: bad.fetch })
  await settle()
  assert.equal(bad.reloads, 0)
  stopBad()
})

test('changed version waits for unsaved input, then reloads when it is cleared', async () => {
  const field = { tagName: 'INPUT', type: 'text', value: '', defaultValue: '', isConnected: true }
  const h = makeHarness({ manifest: { buildId: 'build-b' }, fields: [field] })
  const stop = h.start()
  field.value = 'draft in progress'
  // React may mirror a controlled value into defaultValue while the user types.
  field.defaultValue = field.value
  h.doc.dispatch('input', { target: field })
  await settle()
  // The changed manifest has already been observed; user input blocks the refresh.
  assert.equal(h.reloads, 0)
  field.value = ''
  h.doc.dispatch('input', { target: field })
  assert.equal(h.reloads, 1)
  stop()
})

test('ordinary select navigation does not block an update', async () => {
  const select = { tagName: 'SELECT', value: '2026', isConnected: true }
  const h = makeHarness({ manifest: { buildId: 'build-b' }, fields: [select] })
  const stop = h.start()
  await settle()
  assert.equal(h.reloads, 1)
  stop()
})

test('a recent same-build guard prevents a loop when old HTML is served again', async () => {
  const storage = new MapStorage()
  storage.setItem('app-update-reload-guard', JSON.stringify({ target: 'build-b', lastAttemptAt: 10_000 }))
  const h = makeHarness({ manifest: { buildId: 'build-b' }, storage })
  const stop = h.start('build-a', { now: () => 10_500 })
  await settle()
  assert.equal(h.reloads, 0)
  assert.equal(JSON.parse(storage.getItem('app-update-reload-guard')).lastAttemptAt, 10_000)
  stop()
})

test('disabled storage uses a query marker while preserving the existing URL', async () => {
  const h = makeHarness({ manifest: { buildId: 'build-b' } })
  const stop = h.start('build-a', { sessionStorage: null })
  await settle()
  assert.equal(h.reloads, 0)
  assert.equal(h.replacements.length, 1)
  const target = new URL(h.replacements[0])
  assert.equal(target.pathname, '/app')
  assert.equal(target.searchParams.get('keep'), '1')
  assert.equal(target.searchParams.get('__netric_build'), 'build-b')
  assert.equal(target.hash, '#section')
  stop()
})

test('disabled storage with a marker for the current build cleans only that marker', async () => {
  const h = makeHarness({
    manifest: { buildId: 'build-b' },
    href: 'https://example.test/app?keep=1&__netric_build=build-b#section',
  })
  const stop = h.start('build-b', { sessionStorage: null })
  await settle()
  assert.equal(h.reloads, 0)
  assert.equal(h.replacements.length, 0)
  assert.equal(h.historyReplacements.length, 1)
  assert.equal(h.historyReplacements[0][0], h.win.history.state)
  assert.equal(h.historyReplacements[0][2], '/app?keep=1#section')
  stop()
})

test('an existing marker for the pending build suppresses another fallback reload', async () => {
  const h = makeHarness({
    manifest: { buildId: 'build-b' },
    href: 'https://example.test/app?__netric_build=build-b&keep=1#section',
  })
  const stop = h.start('build-a', { sessionStorage: null })
  await settle()
  assert.equal(h.replacements.length, 0)
  assert.equal(h.reloads, 0)
  stop()
})

test('the session guard caps repeated attempts at two for one target', async () => {
  const storage = new MapStorage()
  storage.setItem('app-update-reload-guard', JSON.stringify({
    target: 'build-b', attempts: 2, lastAttemptAt: 1,
  }))
  const h = makeHarness({ manifest: { buildId: 'build-b' }, storage })
  const stop = h.start('build-a', { now: () => 100_000 })
  await settle()
  assert.equal(h.reloads, 0)
  assert.equal(JSON.parse(storage.getItem('app-update-reload-guard')).attempts, 2)
  stop()
})
