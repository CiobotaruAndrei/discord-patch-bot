import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface ScriptResult {
  name: string;
  code: number;
  output: string;
  elapsed: number;
}

function resolveNpmCli(): string | undefined {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv !== undefined && fromEnv.endsWith(".js")) return fromEnv;
  const beside = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(beside)) return beside;
  const unixPrefix = path.join(
    path.dirname(path.dirname(process.execPath)),
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js"
  );
  if (fs.existsSync(unixPrefix)) return unixPrefix;
  return undefined;
}

function runScript(npmCli: string, name: string): Promise<ScriptResult> {
  return new Promise<ScriptResult>(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [npmCli, "run", name], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error: Error) => {
      resolve({ name, code: 1, output: error.message, elapsed: Date.now() - started });
    });
    child.on("close", (code: number | null) => {
      resolve({ name, code: code ?? 1, output: Buffer.concat(chunks).toString("utf8"), elapsed: Date.now() - started });
    });
  });
}

export async function runParallel(scripts: readonly string[]): Promise<number> {
  if (scripts.length === 0) {
    console.error("run-parallel: niciun script npm dat ca argument");
    return 1;
  }

  const npmCli = resolveNpmCli();
  if (npmCli === undefined) {
    console.error("run-parallel: nu am gasit npm-cli.js; ruleaza scriptul prin npm");
    return 1;
  }

  const results = await Promise.all(scripts.map(name => runScript(npmCli, name)));

  for (const result of results) {
    const status = result.code === 0 ? "ok" : `esec (cod ${result.code})`;
    console.log(`[run-parallel] ${result.name}: ${status}, ${result.elapsed} ms`);
    const output = result.output.trim();
    if (output.length > 0 && result.code !== 0) console.log(output);
  }

  const failed = results.filter(result => result.code !== 0);
  if (failed.length === 0) return 0;
  console.error(`[run-parallel] au esuat: ${failed.map(result => result.name).join(", ")}`);
  return 1;
}

if (process.argv[1] !== undefined && /run-parallel\.(ts|js)$/.test(process.argv[1])) {
  process.exitCode = await runParallel(process.argv.slice(2));
}
