// Cookie consent for optional cookies (Google Analytics). The login token and
// data caches live in localStorage and are strictly necessary, so they are not gated.

const STORAGE_KEY = "netric_cookie_consent"
const CHANGE_EVENT = "netric:cookie-consent"
const GA_ID = "G-NQPSGSD23D"

export const CONSENT_VERSION = "2026-10-26"

export function getCookieConsent() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
    if (stored?.version === CONSENT_VERSION && typeof stored.analytics === "boolean") return stored
  } catch {
    // unreadable or blocked storage counts as no choice yet
  }
  return null
}

function expireAnalyticsCookies() {
  const hosts = [window.location.hostname, `.${window.location.hostname}`]
  document.cookie.split(";").forEach(part => {
    const name = part.split("=")[0].trim()
    if (name !== "_ga" && !name.startsWith("_ga_")) return
    hosts.forEach(domain => {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`
    })
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  })
}

function loadAnalytics() {
  if (document.getElementById("ga-script")) return

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer.push(arguments) }
  window.gtag("js", new Date())
  window.gtag("config", GA_ID)

  const script = document.createElement("script")
  script.id = "ga-script"
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(script)
}

export function initCookieConsent() {
  if (getCookieConsent()?.analytics) loadAnalytics()
}

export function saveCookieConsent(analytics) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics, savedAt: new Date().toISOString() }))
  } catch {
    // choice only lasts for this page view if storage is blocked
  }

  if (analytics) {
    window[`ga-disable-${GA_ID}`] = false
    loadAnalytics()
  } else {
    window[`ga-disable-${GA_ID}`] = true
    expireAnalyticsCookies()
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(CHANGE_EVENT + ":open"))
}

export const COOKIE_EVENTS = { change: CHANGE_EVENT, open: CHANGE_EVENT + ":open" }
