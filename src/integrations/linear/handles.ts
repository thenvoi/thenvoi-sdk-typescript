export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

export function dedupeHandles(handles: Iterable<string>): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const handle of handles) {
    const normalized = normalizeHandle(handle);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}
