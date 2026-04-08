function stripDiacritics(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function normalizeSearchInput(value) {
  return stripDiacritics(value)
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function normalizeSearchFilter(value) {
  return normalizeSearchInput(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}
