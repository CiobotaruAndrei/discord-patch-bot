import { spawnSync } from "node:child_process";

export function parseHostTriple(rustcVersionOutput: string): string | undefined {
  for (const line of rustcVersionOutput.split("\n")) {
    const match = /^host:\s*(\S+)$/.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
}

export function nativeCheckCommands(target: string): string[][] {
  return [
    [
      "clippy",
      "--release",
      "--target",
      target,
      "--manifest-path",
      "native/Cargo.toml",
      "--workspace",
      "--all-targets",
      "--",
      "-D",
      "warnings"
    ],
    [
      "test",
      "--release",
      "--target",
      target,
      "--manifest-path",
      "native/Cargo.toml",
      "-p",
      "discord_patch_bot_logic",
      "-p",
      "native-inspector",
      "--quiet"
    ]
  ];
}

function resolveHostTriple(): string | undefined {
  const probe = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (probe.status !== 0 || typeof probe.stdout !== "string") return undefined;
  return parseHostTriple(probe.stdout);
}

if (process.argv[1] !== undefined && /check-native\.(ts|js)$/.test(process.argv[1])) {
  const target = resolveHostTriple();
  if (target === undefined) {
    console.error("check:native: nu am putut afla tripletul gazda din `rustc -vV`");
    process.exit(1);
  }
  console.log(`[check:native] triplet ${target}, acelasi pe care il foloseste napi build`);
  for (const args of nativeCheckCommands(target)) {
    const result = spawnSync("cargo", args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
