/**
 * The Local AI engine's only fetch: extension files pass, remote fetches are
 * denied except exact pinned files during an explicit install. The service
 * worker's global fetch (Presage and the rest of the background) is untouched.
 */

import { matchesDownloadOrigin } from "@core/domain/localAi/modelRegistry";

export class NetworkBlockedError extends Error {}

export type NetworkGuard = ReturnType<typeof createNetworkGuard>;

export function createNetworkGuard(
  nativeFetch: typeof fetch,
  extensionOrigin: string,
  downloadOrigins: readonly string[],
) {
  let allowed: ReadonlySet<string> | null = null;
  let blockedUrl: string | null = null;
  const extensionPrefix = `${extensionOrigin}/`;

  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      if (request.url.startsWith(extensionPrefix)) {
        return nativeFetch(request);
      }
      if (!allowed?.has(request.url)) {
        blockedUrl = request.url;
        throw new NetworkBlockedError();
      }
      const response = await nativeFetch(request, {
        // The model is stored once, in CacheStorage; an HTTP-cache copy would outlive Delete.
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      const redirectedOff =
        response.url !== "" &&
        response.url !== request.url &&
        !matchesDownloadOrigin(response.url, downloadOrigins);
      if (!allowed || redirectedOff) {
        await response.body?.cancel();
        throw new NetworkBlockedError();
      }
      return response;
    },
    /** The exact URLs an explicit install may download; null denies all network. */
    allowDownloads(urls: ReadonlySet<string> | null): void {
      allowed = urls;
    },
    /** The last network URL refused since the previous call (a file URL, never text), or null. */
    takeBlockedUrl(): string | null {
      const url = blockedUrl;
      blockedUrl = null;
      return url;
    },
  };
}
