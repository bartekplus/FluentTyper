/** Inherited canvases use their creator's site settings and runtime identity. */
export function frameHostname(view: Window = window): string {
  let current = view;
  for (let depth = 0; depth < 8; depth++) {
    try {
      if (current.location.hostname) return current.location.hostname;
      if (current.location.protocol === "blob:") {
        try {
          const host = new URL(current.location.origin).hostname;
          if (host) return host;
        } catch {
          /* Opaque blob origins can still have an accessible creator. */
        }
      }
      if (current.parent === current) break;
      current = current.parent;
    } catch {
      break;
    }
  }
  return "";
}
