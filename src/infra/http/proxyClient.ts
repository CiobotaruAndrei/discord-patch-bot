"use strict";

import type { AxiosResponse } from "axios";
import type { HttpRequestOptions } from "../../types.js";

export interface ProxyClientDeps {
  proxyTemplates: readonly string[];
  httpReq(method: string, url: string, options?: HttpRequestOptions): Promise<AxiosResponse>;
  assertSafeTarget(rawUrl: string, label: string): Promise<string>;
}

export function createProxyClient({ proxyTemplates, httpReq, assertSafeTarget }: ProxyClientDeps) {
  async function fetchWithProxy(targetUrl: string, options: HttpRequestOptions = {}): Promise<string> {
    const safeTargetUrl = await assertSafeTarget(targetUrl, "Proxy target URL");
    if (!proxyTemplates.length) {
      throw new Error("Proxy fallback neconfigurat. Seteaza PROXY_URLS pentru aceasta sursa.");
    }
    let lastErr: unknown;
    for (const template of proxyTemplates) {
      const proxyUrl = template.replace("{url}", encodeURIComponent(safeTargetUrl));
      try {
        const res = await httpReq("GET", proxyUrl, options);
        if (template.includes("allorigins")) {
          return String(res?.data?.contents || "");
        }
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      } catch (err) { lastErr = err; }
    }
    const lastMessage = lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String((lastErr as { message?: unknown }).message)
      : String(lastErr);
    throw new Error(`Proxy fallback epuizat: ${lastMessage}`);
  }

  return { fetchWithProxy };
}
