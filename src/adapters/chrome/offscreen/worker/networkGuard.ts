/** Denies remote fetches except exact pinned files during an explicit install. */

import { matchesDownloadOrigin } from "@core/domain/localAi/modelRegistry";

export const NETWORK_BLOCKED_ERROR_NAME = "LocalAiNetworkBlockedError";

class NetworkBlockedError extends Error {
  constructor() {
    super("Local AI network request blocked");
    this.name = NETWORK_BLOCKED_ERROR_NAME;
  }
}

export interface GuardScope {
  fetch: typeof fetch;
  location: { origin: string };
}

export interface NetworkGuard {
  /** The exact URLs an explicit install may download; null denies all network. */
  allowDownloads(urls: ReadonlySet<string> | null): void;
  /** The last network URL refused since the previous call (a file URL, never text), or null. */
  takeBlockedUrl(): string | null;
}

export function installNetworkGuard(
  scope: GuardScope,
  downloadOrigins: readonly string[],
): NetworkGuard {
  let allowed: ReadonlySet<string> | null = null;
  let blockedUrl: string | null = null;
  const nativeFetch = scope.fetch.bind(scope);
  const extensionPrefix = `${scope.location.origin}/`;

  scope.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
      throw new NetworkBlockedError();
    }
    return response;
  };

  return {
    allowDownloads(urls: ReadonlySet<string> | null): void {
      allowed = urls;
    },
    takeBlockedUrl(): string | null {
      const url = blockedUrl;
      blockedUrl = null;
      return url;
    },
  };
}
