import dns = require("dns");
import net = require("net");

type DnsLookup = typeof dns.lookup;

function parseIPv4(hostname: string): number[] | null {
  const parts = hostname.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = parseIPv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a >= 224);
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return !net.isIP(mappedIpv4) || isPrivateIPv4(mappedIpv4);
  }
  const firstHextet = parseInt(normalized.split(":").find(Boolean) || "0", 16);
  return normalized === "::"
    || normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:0"
    || normalized === "0:0:0:0:0:0:0:1"
    || normalized.startsWith("2001:db8:")
    || ((firstHextet & 0xfe00) === 0xfc00)
    || ((firstHextet & 0xffc0) === 0xfe80)
    || ((firstHextet & 0xff00) === 0xff00);
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function isBlockedExternalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (/^[0-9]+$/.test(normalized) || /^0x[0-9a-f]+$/i.test(normalized)) return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIPv4(normalized);
  if (ipVersion === 6) return isPrivateIPv6(normalized);
  return false;
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIPv4(normalized);
  if (ipVersion === 6) return isPrivateIPv6(normalized);
  return true;
}

function assertSafeExternalUrl(rawUrl: unknown, label = "URL extern"): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error(`${label} lipseste sau nu este string.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} nu este URL valid.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} trebuie sa foloseasca http sau https.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} nu poate contine credentiale.`);
  }
  if (isBlockedExternalHostname(parsed.hostname)) {
    throw new Error(`${label} pointeaza catre o adresa locala sau privata.`);
  }
  return parsed.href;
}

function createSafeDnsLookup(baseLookup: DnsLookup = dns.lookup): DnsLookup {
  return ((hostname: string, options: unknown, callback?: unknown) => {
    const cb = typeof callback === "function" ? callback as (...args: unknown[]) => void : options as (...args: unknown[]) => void;
    const lookupOptions = typeof callback === "function"
      ? options as dns.LookupOneOptions | dns.LookupAllOptions
      : undefined;

    const handleLookupResult = (err: NodeJS.ErrnoException | null, address: unknown, family?: unknown): void => {
      if (err) {
        cb(err, address, family);
        return;
      }

      const addresses = Array.isArray(address)
        ? address.map(item => String((item as { address?: unknown }).address || ""))
        : [String(address || "")];
      const blocked = addresses.find(candidate => isBlockedIpAddress(candidate));
      if (blocked) {
        cb(new Error(`DNS pentru ${hostname} pointeaza catre o adresa locala sau privata (${blocked}).`));
        return;
      }

      cb(null, address, family);
    };

    if (lookupOptions) {
      baseLookup(hostname, lookupOptions, handleLookupResult);
    } else {
      baseLookup(hostname, handleLookupResult);
    }
  }) as DnsLookup;
}

async function assertSafeExternalDnsTarget(
  rawUrl: unknown,
  label = "URL extern",
  lookup: DnsLookup = dns.lookup
): Promise<string> {
  const safeUrl = assertSafeExternalUrl(rawUrl, label);
  const parsed = new URL(safeUrl);
  const hostname = normalizeHostname(parsed.hostname);
  if (net.isIP(hostname)) return safeUrl;

  const addresses = await new Promise<string[]>((resolve, reject) => {
    lookup(hostname, { all: true, verbatim: true }, (err: NodeJS.ErrnoException | null, result: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      const resolved = Array.isArray(result)
        ? result.map(item => String((item as { address?: unknown }).address || "")).filter(Boolean)
        : [String(result || "")].filter(Boolean);
      resolve(resolved);
    });
  });

  if (!addresses.length) {
    throw new Error(`${label} nu a returnat niciun rezultat DNS.`);
  }
  const blocked = addresses.find(candidate => isBlockedIpAddress(candidate));
  if (blocked) {
    throw new Error(`${label} rezolva DNS catre o adresa locala sau privata (${blocked}).`);
  }
  return safeUrl;
}

export {
  parseIPv4,
  isPrivateIPv4,
  isPrivateIPv6,
  normalizeHostname,
  isBlockedExternalHostname,
  isBlockedIpAddress,
  assertSafeExternalUrl,
  createSafeDnsLookup,
  assertSafeExternalDnsTarget
};
export type { DnsLookup };
