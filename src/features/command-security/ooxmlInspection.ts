"use strict";

function xmlAttribute(element: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = pattern.exec(element);
  if (!match) return null;
  return match[2] ?? match[3] ?? "";
}

function isRemoteTarget(target: string): boolean {
  const lower = target.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("ftp://") || lower.startsWith("file://") || lower.startsWith("\\\\");
}

export function ooxmlRelationshipIndicators(buffer: Buffer): string[] {
  const text = buffer.toString("latin1");
  const indicators: string[] = [];
  let offset = 0;
  let parsed = 0;
  while (parsed < 512) {
    const start = text.indexOf("<Relationship", offset);
    if (start === -1) break;
    const close = text.indexOf(">", start);
    if (close === -1) break;
    const element = text.slice(start, close);
    parsed++;
    offset = close + 1;
    const relationType = (xmlAttribute(element, "type") ?? "").toLowerCase();
    const target = xmlAttribute(element, "target") ?? "";
    const external = (xmlAttribute(element, "targetmode") ?? "").toLowerCase() === "external";
    if (relationType.endsWith("/vbaproject")) indicators.push("macro sau script Office intern");
    if (relationType.endsWith("/oleobject") || relationType.endsWith("/package")) {
      indicators.push("obiect OLE incorporat in document Office");
    }
    if (external && (relationType.endsWith("/attachedtemplate") || relationType.endsWith("/frame"))) {
      indicators.push("sablon sau cadru Office incarcat dintr-o sursa externa (relatie OOXML)");
    }
    if (external || isRemoteTarget(target)) indicators.push("referinta externa in document Office");
  }
  return [...new Set(indicators)];
}
