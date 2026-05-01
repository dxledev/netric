const DEFAULT_API_BASE = "http://localhost:8000"

function normalizeConfiguredBase(value) {
  if (!value) {
    return null
  }

  const trimmedValue = String(value).trim()

  if (!trimmedValue) {
    return null
  }

  if (trimmedValue.startsWith("/")) {
    return trimmedValue.replace(/\/+$/, "") || "/"
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue.replace(/\/+$/, "")
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${trimmedValue}`.replace(/\/+$/, "")
  }

  return `http://${trimmedValue}`.replace(/\/+$/, "")
}

function resolveDefaultApiBase() {
  if (typeof window === "undefined") {
    return DEFAULT_API_BASE
  }

  const { protocol, hostname } = window.location
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1"

  if (isLocalHost) {
    return DEFAULT_API_BASE
  }

  return "/api"
}

export const API_BASE =
  normalizeConfiguredBase(import.meta.env.VITE_API_BASE) || resolveDefaultApiBase()
