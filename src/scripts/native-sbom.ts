"use strict";

import fs from "node:fs";
import path from "node:path";

export interface NativeComponent {
  crate: string;
  kind: "c-static" | "cpp-static" | "c-system" | "rust";
  vendored: string;
  role: string;
}

export interface SbomEntry extends NativeComponent {
  version: string;
}

export const NATIVE_COMPONENTS: readonly NativeComponent[] = [
  { crate: "magic", kind: "c-system", vendored: "libmagic de sistem (file 5.x)", role: "detectie tip real + MIME + encoding" },
  { crate: "magic-sys", kind: "c-system", vendored: "libmagic de sistem (file 5.x)", role: "legaturi FFI pentru libmagic" },
  { crate: "yara", kind: "c-static", vendored: "YARA 4.5.5", role: "motor de reguli malware" },
  { crate: "yara-sys", kind: "c-static", vendored: "YARA 4.5.5", role: "legaturi FFI pentru libyara" },
  { crate: "libarchive2-sys", kind: "c-static", vendored: "libarchive 3.8.1", role: "decodare arhive RAR/7z si filtre" },
  { crate: "qpdf", kind: "cpp-static", vendored: "qpdf + zlib + libjpeg", role: "structura PDF complexa" },
  { crate: "qpdf-sys", kind: "cpp-static", vendored: "qpdf + zlib + libjpeg", role: "legaturi FFI pentru qpdf" },
  { crate: "libseccomp", kind: "c-system", vendored: "libseccomp de sistem", role: "filtru de syscall in procesul izolat" },
  { crate: "libseccomp-sys", kind: "c-system", vendored: "libseccomp de sistem", role: "legaturi FFI pentru libseccomp" },
  { crate: "goblin", kind: "rust", vendored: "-", role: "parsare PE/ELF/Mach-O" },
  { crate: "idna", kind: "rust", vendored: "-", role: "UTS#46, Punycode" },
  { crate: "unicode-security", kind: "rust", vendored: "-", role: "UTS#39, confusables" },
  { crate: "publicsuffix", kind: "rust", vendored: "-", role: "eTLD+1" },
  { crate: "rqrr", kind: "rust", vendored: "-", role: "decodare coduri QR" },
  { crate: "image", kind: "rust", vendored: "-", role: "decodare imagini" },
  { crate: "msi", kind: "rust", vendored: "-", role: "citirea randurilor din baza de date MSI" },
  { crate: "flate2", kind: "rust", vendored: "-", role: "inflate pentru fluxuri PDF si ZIP" },
  { crate: "sha2", kind: "rust", vendored: "-", role: "hash de continut" }
];

export function parseLockVersions(lockText: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const block of lockText.split("[[package]]")) {
    const name = /name\s*=\s*"([^"]+)"/.exec(block);
    const version = /version\s*=\s*"([^"]+)"/.exec(block);
    if (name && version) versions.set(name[1], version[1]);
  }
  return versions;
}

export function buildSbom(lockText: string, components: readonly NativeComponent[] = NATIVE_COMPONENTS): {
  entries: SbomEntry[];
  missing: string[];
} {
  const versions = parseLockVersions(lockText);
  const entries: SbomEntry[] = [];
  const missing: string[] = [];
  for (const component of components) {
    const version = versions.get(component.crate);
    if (version === undefined) {
      missing.push(component.crate);
      continue;
    }
    entries.push({ ...component, version });
  }
  return { entries, missing };
}

export function renderSbomTable(entries: readonly SbomEntry[]): string {
  const header = "| Crate | Versiune | Tip | Sursa C/C++ | Rol |\n| --- | --- | --- | --- | --- |";
  const rows = entries.map(entry => `| \`${entry.crate}\` | ${entry.version} | ${entry.kind} | ${entry.vendored} | ${entry.role} |`);
  return [header, ...rows].join("\n");
}

export function readLock(root: string): string {
  return fs.readFileSync(path.join(root, "native", "Cargo.lock"), "utf8");
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("native-sbom.js")) {
  const { entries, missing } = buildSbom(readLock(process.cwd()));
  if (missing.length > 0) {
    console.error(`Crate-uri native declarate dar absente din Cargo.lock: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(renderSbomTable(entries));
}
