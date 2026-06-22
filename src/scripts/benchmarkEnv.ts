"use strict";

function parseStrictEnvNumber(
  name: string,
  fallback: number,
  opts: { integer?: boolean; min?: number }
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  const min = opts.min ?? Number.NEGATIVE_INFINITY;
  const invalid =
    !Number.isFinite(parsed) ||
    (opts.integer === true && !Number.isInteger(parsed)) ||
    parsed < min;
  if (invalid) {
    const kind = opts.integer === true ? "un intreg" : "un numar finit";
    const bound = min > Number.NEGATIVE_INFINITY ? ` >= ${min}` : "";
    throw new Error(
      `${name}="${raw}" nu e ${kind}${bound} valid (typo?) — seteaza o valoare numerica corecta sau lasa variabila nesetata pentru default ${fallback}`
    );
  }
  return parsed;
}

export function strictEnvFloat(name: string, fallback: number, min = 0): number {
  return parseStrictEnvNumber(name, fallback, { min });
}

export function strictEnvInt(name: string, fallback: number, min = 1): number {
  return parseStrictEnvNumber(name, fallback, { integer: true, min });
}

export {};
