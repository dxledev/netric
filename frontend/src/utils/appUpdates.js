const MANIFEST_URL = '/version.json'
const RELOAD_GUARD_KEY = 'app-update-reload-guard'
const RELOAD_MARKER_PARAM = '__netric_build'
const RELOAD_GUARD_WINDOW_MS = 60_000
const MAX_RELOAD_ATTEMPTS = 2
const CHECK_INTERVAL_MS = 60_000
const REQUEST_TIMEOUT_MS = 5_000

const validBuildId = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value)

function captureBaseline(field, baselines) {
  if (baselines.has(field)) return

  if (field.isContentEditable) {
    baselines.set(field, { text: field.textContent ?? '' })
  } else if (isDraftTextInput(field) && 'value' in field) {
    baselines.set(field, { value: field.value })
  }
}

function isDraftTextInput(field) {
  if (field.tagName === 'TEXTAREA') return true
  if (field.tagName !== 'INPUT') return false
  return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(
    String(field.type || 'text').toLowerCase(),
  )
}

function hasUnsavedFormInput(document, baselines) {
  if (typeof document.querySelectorAll !== 'function') return false

  const fields = document.querySelectorAll(
    'input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"], input:not([type]), textarea, [contenteditable="true"], [contenteditable=""]',
  )
  return Array.from(fields).some((field) => {
    if (field.isConnected === false) return false
    captureBaseline(field, baselines)
    const baseline = baselines.get(field)
    if (baseline && 'text' in baseline) return (field.textContent ?? '') !== baseline.text
    return Boolean(baseline && 'value' in baseline && field.value !== baseline.value)
  })
}

/** Start checking for a newly deployed frontend bundle. Returns a cleanup function. */
export function startAppUpdateChecks(buildId, options = {}) {
  if (!validBuildId(buildId)) return () => {}

  const win = options.window ?? globalThis.window
  const doc = options.document ?? globalThis.document
  const fetchImpl = options.fetch ?? globalThis.fetch
  const storage = Object.hasOwn(options, 'sessionStorage') ? options.sessionStorage : (() => {
    try {
      return win.sessionStorage
    } catch {
      return null
    }
  })()
  const now = options.now ?? Date.now
  const timers = options.timers ?? globalThis
  if (!win || !doc || typeof fetchImpl !== 'function') return () => {}

  let stopped = false
  let checking = false
  let reloadStarted = false
  let pendingBuildId = null
  let intervalId
  const fieldBaselines = new WeakMap()
  if (typeof doc.querySelectorAll === 'function') {
    for (const field of doc.querySelectorAll(
      'input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"], input:not([type]), textarea, [contenteditable="true"], [contenteditable=""]',
    )) captureBaseline(field, fieldBaselines)
  }

  const readReloadMarker = () => {
    try {
      return new URL(win.location.href).searchParams.get(RELOAD_MARKER_PARAM)
    } catch {
      return null
    }
  }
  const cleanCurrentBuildMarker = () => {
    try {
      const url = new URL(win.location.href)
      if (url.searchParams.get(RELOAD_MARKER_PARAM) !== buildId) return
      url.searchParams.delete(RELOAD_MARKER_PARAM)
      win.history?.replaceState(win.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {
      // Marker cleanup is best-effort; it does not affect update detection.
    }
  }
  cleanCurrentBuildMarker()

  const reloadFor = (targetBuildId) => {
    if (stopped || reloadStarted) return
    if (hasUnsavedFormInput(doc, fieldBaselines)) {
      pendingBuildId = targetBuildId
      return
    }

    if (readReloadMarker() === targetBuildId && targetBuildId !== buildId) return

    let storageGuardAvailable = Boolean(storage)
    if (storageGuardAvailable) {
      try {
        const previous = JSON.parse(storage.getItem(RELOAD_GUARD_KEY) || 'null')
        const sameTarget = previous?.target === targetBuildId
        const attempts = sameTarget
          ? (Number.isInteger(previous.attempts) ? previous.attempts : 1)
          : 0
        if (attempts >= MAX_RELOAD_ATTEMPTS) return
        const attemptedRecently = sameTarget && Number.isFinite(previous.lastAttemptAt) &&
          now() - previous.lastAttemptAt < RELOAD_GUARD_WINDOW_MS
        if (attemptedRecently) return
        storage.setItem(RELOAD_GUARD_KEY, JSON.stringify({
          target: targetBuildId,
          attempts: attempts + 1,
          lastAttemptAt: now(),
        }))
      } catch {
        storageGuardAvailable = false
      }
    }

    reloadStarted = true
    if (!storageGuardAvailable) {
      try {
        const url = new URL(win.location.href)
        url.searchParams.set(RELOAD_MARKER_PARAM, targetBuildId)
        win.location.replace(url.toString())
        return
      } catch {
        // Fall through to a regular reload if the URL cannot be read or replaced.
      }
    }
    win.location.reload()
  }

  const check = async () => {
    if (stopped || checking || reloadStarted) return
    checking = true
    const controller = new AbortController()
    const timeoutId = timers.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(`${MANIFEST_URL}?t=${now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (!response?.ok) return
      const manifest = await response.json()
      if (!validBuildId(manifest?.buildId) || manifest.buildId === buildId) return
      pendingBuildId = manifest.buildId
      reloadFor(manifest.buildId)
    } catch {
      // Network errors, timeouts, and invalid JSON are transient; the next trigger retries.
    } finally {
      timers.clearTimeout(timeoutId)
      checking = false
    }
  }

  const tryPendingReload = () => {
    if (pendingBuildId && !hasUnsavedFormInput(doc, fieldBaselines)) reloadFor(pendingBuildId)
  }
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'visible') void check()
  }
  const onPageShow = () => void check()
  const onFocus = () => void check()
  const onEdit = () => tryPendingReload()
  const onFocusIn = (event) => {
    const field = event.target
    if (field) captureBaseline(field, fieldBaselines)
  }
  const onReset = () => timers.setTimeout(tryPendingReload, 0)
  const onInterval = () => {
    if (doc.visibilityState === 'visible') void check()
  }

  win.addEventListener('focus', onFocus)
  win.addEventListener('pageshow', onPageShow)
  doc.addEventListener('visibilitychange', onVisibilityChange)
  doc.addEventListener('input', onEdit, true)
  doc.addEventListener('change', onEdit, true)
  doc.addEventListener('focusin', onFocusIn, true)
  doc.addEventListener('reset', onReset, true)
  intervalId = timers.setInterval(onInterval, CHECK_INTERVAL_MS)
  void check()

  return () => {
    stopped = true
    timers.clearInterval(intervalId)
    win.removeEventListener('focus', onFocus)
    win.removeEventListener('pageshow', onPageShow)
    doc.removeEventListener('visibilitychange', onVisibilityChange)
    doc.removeEventListener('input', onEdit, true)
    doc.removeEventListener('change', onEdit, true)
    doc.removeEventListener('focusin', onFocusIn, true)
    doc.removeEventListener('reset', onReset, true)
  }
}
