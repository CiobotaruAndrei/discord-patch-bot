"use strict";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface FileProfile {
  file: string;
  totalMs: number;
  workMs: number;
  lingerMs: number;
}

export interface ProfileSummary {
  slowest: FileProfile[];
  lingering: FileProfile[];
  medianMs: number;
  totalMs: number;
}

const LANES = 8;
const LINGER_THRESHOLD_MS = 250;

export function summarizeProfile(profiles: readonly FileProfile[], top = 20): ProfileSummary {
  const sorted = [...profiles].sort((a, b) => b.totalMs - a.totalMs);
  const byLinger = [...profiles].filter(entry => entry.lingerMs >= LINGER_THRESHOLD_MS).sort((a, b) => b.lingerMs - a.lingerMs);
  const middle = [...profiles].sort((a, b) => a.totalMs - b.totalMs);
  const medianMs = middle.length === 0 ? 0 : middle[Math.floor(middle.length / 2)].totalMs;
  return {
    slowest: sorted.slice(0, top),
    lingering: byLinger,
    medianMs,
    totalMs: profiles.reduce((acc, entry) => acc + entry.totalMs, 0)
  };
}

export function collectTestFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.js")) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

function profileFile(file: string): Promise<FileProfile> {
  return new Promise(resolve => {
    const specifier = JSON.stringify(`./${file.split(path.sep).join("/")}`);
    const source = [
      "const started = Date.now();",
      "let work = 0;",
      "process.on('exit', () => console.error('LINGER ' + (Date.now() - started - work)));",
      `await import(${specifier});`,
      "work = Date.now() - started;",
      "console.error('WORK ' + work);"
    ].join("\n");
    const started = Date.now();
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("close", () => {
      const work = /WORK (\d+)/.exec(stderr);
      const linger = /LINGER (\d+)/.exec(stderr);
      resolve({
        file,
        totalMs: Date.now() - started,
        workMs: work ? Number(work[1]) : -1,
        lingerMs: linger ? Number(linger[1]) : -1
      });
    });
    child.on("error", () => resolve({ file, totalMs: Date.now() - started, workMs: -1, lingerMs: -1 }));
  });
}

export async function profileTests(root = "dist/test"): Promise<FileProfile[]> {
  const files = collectTestFiles(root);
  const profiles: FileProfile[] = [];
  let index = 0;
  const lane = async (): Promise<void> => {
    while (index < files.length) {
      const file = files[index++];
      profiles.push(await profileFile(file));
    }
  };
  await Promise.all(Array.from({ length: LANES }, () => lane()));
  return profiles;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("profile-tests.js")) {
  const profiles = await profileTests();
  const summary = summarizeProfile(profiles);
  console.log(`fisiere: ${profiles.length}, mediana: ${summary.medianMs} ms, suma: ${summary.totalMs} ms\n`);
  console.log("--- cele mai lente ---");
  for (const entry of summary.slowest) console.log(`${String(entry.totalMs).padStart(7)} ms  ${entry.file}`);
  if (summary.lingering.length > 0) {
    console.log(`\n--- fisiere care tin procesul viu dupa ce testele s-au terminat (peste ${LINGER_THRESHOLD_MS} ms) ---`);
    for (const entry of summary.lingering) {
      console.log(`${String(entry.lingerMs).padStart(7)} ms agatat (lucru ${entry.workMs} ms)  ${entry.file}`);
    }
    console.log("\nUn timer nedeschis sau o asteptare reala tine event loop-ul; injecteaza ceasul sau foloseste unref().");
  }
}
