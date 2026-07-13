import { assertSafeExternalUrl } from "./ssrfGuard.js";

const BUILTIN_DEFAULT_PROXIES = [
  "https://api.allorigins.win/get?url={url}",
  "https://api.codetabs.com/v1/proxy?quest={url}"
];

function resolveDefaultProxies(nodeEnv: string | undefined, isProd: boolean, allowFlag: boolean): string[] {
  if (isProd) return [];
  const allowed = nodeEnv === "development" || allowFlag;
  return allowed ? [...BUILTIN_DEFAULT_PROXIES] : [];
}

function normalizeProxyTemplates(rawTemplates: string, defaults: string[]): string[] {
  const candidates = rawTemplates
    ? rawTemplates.split(",").map(s => s.trim()).filter(Boolean)
    : defaults;
  const seen = new Set<string>();
  return candidates.map(template => {
    if (!template.includes("{url}")) {
      throw new Error("PROXY_URLS trebuie sa contina placeholder-ul {url}.");
    }
    const probeUrl = template.replace("{url}", encodeURIComponent("https://example.com/patch"));
    assertSafeExternalUrl(probeUrl, "PROXY_URLS template");
    return template;
  }).filter(template => {
    if (seen.has(template)) return false;
    seen.add(template);
    return true;
  });
}

export { BUILTIN_DEFAULT_PROXIES, resolveDefaultProxies, normalizeProxyTemplates };
