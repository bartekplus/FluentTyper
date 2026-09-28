/**
 * Network guard for the Local AI worker.
 *
 * WebLLM fetches model data two ways: `fetch()` (the packaged model library)
 * and `Cache.prototype.add()` (config, tokenizer, weight shards), whose
 * internal fetch cannot be intercepted by replacing `fetch`. Both are patched
 * here so that:
 * - extension-origin URLs are always allowed (packaged WASM, no network);
 * - network URLs are allowed ONLY while an explicit install runs, and only for
 *   the allowlisted download origins, including the final URL after redirects;
 * - every network request goes out without credentials, referrer or HTTP caching.
 * Outside an install (review loads, generation) all network requests fail, so
 * a partial cache fails honestly instead of silently downloading.
 */

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
  Cache?: { prototype: Cache };
}

export interface NetworkGuard {
  setNetworkAllowed(allowed: boolean): void;
}

export function installNetworkGuard(
  scope: GuardScope,
  allowedOrigins: readonly string[],
): NetworkGuard {
  let networkAllowed = false;
  const nativeFetch = scope.fetch.bind(scope);
  const extensionPrefix = `${scope.location.origin}/`;

  const isAllowedDownload = (url: string): boolean => {
    try {
      return allowedOrigins.includes(new URL(url).origin);
    } catch {
      return false;
    }
  };

  const guardedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.url.startsWith(extensionPrefix)) {
      return nativeFetch(request);
    }
    if (!networkAllowed || !isAllowedDownload(request.url)) {
      throw new NetworkBlockedError();
    }
    const response = await nativeFetch(request, {
      // The model is stored once, in CacheStorage; an HTTP-cache copy would outlive Delete.
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!networkAllowed || (response.url !== "" && !isAllowedDownload(response.url))) {
      throw new NetworkBlockedError();
    }
    return response;
  };

  scope.fetch = guardedFetch;

  const cachePrototype = scope.Cache?.prototype;
  if (cachePrototype) {
    cachePrototype.add = async function add(this: Cache, info: RequestInfo | URL): Promise<void> {
      const request = new Request(info);
      const response = await guardedFetch(request);
      if (!response.ok) {
        throw new TypeError("Local AI download failed");
      }
      await this.put(request, response);
    };
    cachePrototype.addAll = async function addAll(
      this: Cache,
      infos: Iterable<RequestInfo>,
    ): Promise<void> {
      for (const info of infos) {
        await this.add(info);
      }
    };
  }

  return {
    setNetworkAllowed(allowed: boolean): void {
      networkAllowed = allowed;
    },
  };
}
