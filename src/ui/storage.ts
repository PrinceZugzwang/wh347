/**
 * Remembers the project header and column mapping between weekly visits.
 * Storage can be unavailable (private windows, blocked site data), in which
 * case the app simply starts empty.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`wh347:${key}`);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`wh347:${key}`, JSON.stringify(value));
  } catch {
    // Storage is a convenience here; the payroll still works without it.
  }
}
