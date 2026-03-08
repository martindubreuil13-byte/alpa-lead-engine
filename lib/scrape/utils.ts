export function extractEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

export function extractPhone(text: string) {
  const match = text.match(/(\+?1[\s.-]?)?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  return match ? match[0].replace(/\s+/g, " ").trim() : null;
}

export function normalizeUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function pickTitle(title: string | undefined) {
  if (!title) return null;
  return title.replace(/\s+\|\s+.*/, "").trim();
}
