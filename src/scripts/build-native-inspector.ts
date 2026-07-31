import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseHostTriple } from "./check-native.js";

export function inspectorBuildArgs(target: string): string[] {
  return [
    "build",
    "--release",
    "--target",
    target,
    "--manifest-path",
    "native/Cargo.toml",
    "-p",
    "native-inspector",
    "--bin",
    "native-inspector"
  ];
}

export function inspectorArtifactName(platform: string): string {
  return platform === "win32" ? "native-inspector.exe" : "native-inspector";
}

export function inspectorArtifactPaths(target: string, platform: string): { built: string; installed: string } {
  const artifact = inspectorArtifactName(platform);
  return {
    built: path.join("native", "target", target, "release", artifact),
    installed: path.join("native", artifact)
  };
}

function resolveHostTriple(): string | undefined {
  const probe = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (probe.status !== 0 || typeof probe.stdout !== "string") return undefined;
  return parseHostTriple(probe.stdout);
}

if (process.argv[1] !== undefined && /build-native-inspector\.(ts|js)$/.test(process.argv[1])) {
  const target = resolveHostTriple();
  if (target === undefined) {
    console.error("build:inspector: nu am putut afla tripletul gazda din `rustc -vV`");
    process.exit(1);
  }
  console.log(`[build:inspector] triplet ${target}, acelasi pe care il foloseste napi build`);
  const result = spawnSync("cargo", inspectorBuildArgs(target), { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const { built, installed } = inspectorArtifactPaths(target, process.platform);
  fs.copyFileSync(built, installed);
  console.log(`[build:inspector] ${installed}`);
}
