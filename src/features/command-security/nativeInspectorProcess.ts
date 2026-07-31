"use strict";

import type { InspectorMetricRecorder } from "../../shared/metricRecorderPorts.js";
import { spawn } from "node:child_process";
import type { InspectionLimits, InspectionReport } from "./passiveArchiveInspection.js";

export interface InspectorLogger {
  (level: string, context: string, message: string, meta?: unknown): void;
}

export interface InspectorStream {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  removeAllListeners(): unknown;
}

export interface InspectorChild {
  stdout: InspectorStream;
  stderr: InspectorStream;
  stdin: { write(chunk: Buffer): unknown };
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  removeAllListeners(): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

export type SpawnInspector = (command: string, args: string[], options: { stdio: ["pipe", "pipe", "pipe"] }) => InspectorChild;

export interface InspectorDeps {
  binaryPath: string;
  spawnProcess?: SpawnInspector;
  logger?: InspectorLogger;
  metrics?: InspectorMetricRecorder;
  requestTimeoutMs?: number;
  maxRestarts?: number;
}

export interface InspectorOutcome {
  report: InspectionReport | null;
  sandboxed: boolean;
  failure: string;
}

const PROTOCOL_VERSION = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESTARTS = 5;
const MAX_TEXT_BYTES = 4096;

function encodeText(value: string): Buffer {
  const raw = Buffer.from(value, "utf8").subarray(0, MAX_TEXT_BYTES);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(raw.length, 0);
  return Buffer.concat([header, raw]);
}

export function encodeRequest(
  content: Buffer,
  filename: string,
  mime: string,
  mode: string,
  limits: InspectionLimits
): Buffer {
  const head = Buffer.alloc(6);
  head.write("DPBI", 0, "ascii");
  head.writeUInt16LE(PROTOCOL_VERSION, 4);
  const numbers = Buffer.alloc(32);
  numbers.writeUInt32LE(limits.maxDepth, 0);
  numbers.writeUInt32LE(limits.maxEntries, 4);
  numbers.writeBigUInt64LE(BigInt(Math.trunc(limits.maxExpandedBytes)), 8);
  numbers.writeDoubleLE(limits.maxCompressionRatio, 16);
  numbers.writeBigUInt64LE(BigInt(Math.trunc(limits.timeoutMs)), 24);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(content.length), 0);
  return Buffer.concat([
    head,
    encodeText(filename),
    encodeText(mime),
    encodeText(mode),
    numbers,
    length,
    content
  ]);
}

class FrameReader {
  private buffer = Buffer.alloc(0);
  private offset = 0;

  append(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  private available(bytes: number): boolean {
    return this.buffer.length - this.offset >= bytes;
  }

  private text(): string | null {
    if (!this.available(4)) return null;
    const length = this.buffer.readUInt32LE(this.offset);
    if (length > MAX_TEXT_BYTES || !this.available(4 + length)) return null;
    const value = this.buffer.subarray(this.offset + 4, this.offset + 4 + length).toString("utf8");
    this.offset += 4 + length;
    return value;
  }

  readReady(): boolean | null {
    if (!this.available(5)) return null;
    if (this.buffer.subarray(this.offset, this.offset + 4).toString("ascii") !== "DPBR") return null;
    const sandboxed = this.buffer[this.offset + 4] !== 0;
    this.offset += 5;
    this.compact();
    return sandboxed;
  }

  readResponse(): { report: InspectionReport; sandboxed: boolean } | null {
    const start = this.offset;
    if (!this.available(6)) return null;
    if (this.buffer.subarray(this.offset, this.offset + 4).toString("ascii") !== "DPBO") {
      throw new Error("raspuns fara semnatura DPBO");
    }
    if (this.buffer.readUInt16LE(this.offset + 4) !== PROTOCOL_VERSION) {
      throw new Error("versiune de protocol necunoscuta in raspuns");
    }
    this.offset += 6;
    const status = this.text();
    const reason = this.text();
    if (status === null || reason === null) return this.rewind(start);
    if (!this.available(4)) return this.rewind(start);
    const count = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    const indicators: string[] = [];
    for (let index = 0; index < count; index++) {
      const value = this.text();
      if (value === null) return this.rewind(start);
      indicators.push(value);
    }
    if (!this.available(22)) return this.rewind(start);
    const entriesInspected = this.buffer.readUInt32LE(this.offset);
    const expandedBytes = Number(this.buffer.readBigUInt64LE(this.offset + 4));
    const elapsedMs = this.buffer.readDoubleLE(this.offset + 12);
    const sandboxed = this.buffer[this.offset + 20] !== 0;
    const hasUninspectableFormat = this.buffer[this.offset + 21] !== 0;
    this.offset += 22;
    let uninspectableFormat: string | undefined;
    if (hasUninspectableFormat) {
      const value = this.text();
      if (value === null) return this.rewind(start);
      uninspectableFormat = value;
    }
    if (!this.available(4)) return this.rewind(start);
    const spotCount = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    const analysisBlindSpots: string[] = [];
    for (let index = 0; index < spotCount; index++) {
      const value = this.text();
      if (value === null) return this.rewind(start);
      analysisBlindSpots.push(value);
    }
    this.compact();
    return {
      report: {
        status: status === "uncertain" ? "uncertain" : "inspected",
        indicators,
        reason,
        entriesInspected,
        expandedBytes,
        elapsedMs,
        uninspectableFormat,
        analysisBlindSpots: analysisBlindSpots.length > 0 ? analysisBlindSpots : undefined
      },
      sandboxed
    };
  }

  private rewind(start: number): null {
    this.offset = start;
    return null;
  }

  private compact(): void {
    this.buffer = this.buffer.subarray(this.offset);
    this.offset = 0;
  }
}

export function createNativeInspectorClient(deps: InspectorDeps) {
  const spawnProcess: SpawnInspector = deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRestarts = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  let child: InspectorChild | null = null;
  let reader = new FrameReader();
  let sandboxed = false;
  let restarts = 0;
  let busy = false;
  let ready: Promise<boolean> | null = null;
  let onReady: ((state: boolean) => void) | null = null;
  let onFrame: ((decoded: { report: InspectionReport; sandboxed: boolean }) => void) | null = null;
  let onBroken: ((failure: string) => void) | null = null;

  const log = (level: string, message: string, meta?: unknown): void => {
    deps.logger?.(level, "NATIVE-INSPECTOR", message, meta);
  };

  const dispose = (): void => {
    if (child) {
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.kill("SIGKILL");
      child = null;
    }
    reader = new FrameReader();
    ready = null;
    onReady = null;
    onFrame = null;
    onBroken = null;
  };

  const pump = (chunk: Buffer): void => {
    reader.append(chunk);
    if (onReady) {
      const state = reader.readReady();
      if (state === null) return;
      const notify = onReady;
      onReady = null;
      notify(state);
    }
    while (onFrame) {
      let decoded: { report: InspectionReport; sandboxed: boolean } | null;
      try {
        decoded = reader.readResponse();
      } catch (error) {
        const broken = onBroken;
        onFrame = null;
        onBroken = null;
        broken?.(error instanceof Error ? error.message : String(error));
        return;
      }
      if (!decoded) return;
      const notify = onFrame;
      onFrame = null;
      notify(decoded);
    }
  };

  const start = (): Promise<boolean> => {
    if (ready) return ready;
    ready = new Promise<boolean>((resolve, reject) => {
      const spawned = spawnProcess(deps.binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
      child = spawned;
      const timer = setTimeout(() => {
        reject(new Error("procesul de inspectie nu a raportat starea sandbox-ului la timp"));
      }, requestTimeoutMs);
      onReady = (state: boolean): void => {
        clearTimeout(timer);
        sandboxed = state;
        if (state) {
          deps.metrics?.sandboxApplied(true);
        } else {
          log("WARN", "Procesul de inspectie ruleaza FARA filtru de syscall pe aceasta platforma");
          deps.metrics?.sandboxApplied(false);
        }
        resolve(state);
      };
      spawned.stdout.on("data", pump);
      spawned.stderr.on("data", chunk => { log("INFO", String(chunk).trim()); });
      spawned.on("error", error => { clearTimeout(timer); reject(error); });
      spawned.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (onBroken) {
          deps.metrics?.processKilled();
          log("ERROR", "Procesul de inspectie a fost oprit in timpul unui job; verdictul ramane neconfirmat", { code, signal });
          const broken = onBroken;
          onFrame = null;
          onBroken = null;
          broken(`procesul de inspectie s-a oprit (cod ${code}, semnal ${signal})`);
          return;
        }
        child = null;
        ready = null;
        reject(new Error(`procesul de inspectie a iesit inainte sa fie gata (cod ${code}, semnal ${signal})`));
      });
    });
    return ready;
  };

  const runInspection = async (
    content: Buffer,
    filename: string,
    mime: string,
    mode: string,
    limits: InspectionLimits
  ): Promise<InspectorOutcome> => {
    try {
      await start();
    } catch (error) {
      dispose();
      return { report: null, sandboxed: false, failure: error instanceof Error ? error.message : String(error) };
    }
    const spawned = child;
    if (!spawned) return { report: null, sandboxed, failure: "procesul de inspectie nu este pornit" };

    return new Promise<InspectorOutcome>(resolve => {
      let settled = false;
      const finish = (outcome: InspectorOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        onFrame = null;
        onBroken = null;
        resolve(outcome);
      };
      const restart = (failure: string): void => {
        const current = sandboxed;
        dispose();
        restarts += 1;
        deps.metrics?.processRestarted(restarts);
        if (restarts > maxRestarts) {
          log("ERROR", "Procesul de inspectie a fost repornit prea des; verdictul ramane neconfirmat", { restarts });
        }
        finish({ report: null, sandboxed: current, failure });
      };
      const timer = setTimeout(() => {
        deps.metrics?.scanTimedOut();
        restart(`inspectia a depasit ${requestTimeoutMs} ms`);
      }, requestTimeoutMs);

      onFrame = decoded => { finish({ report: decoded.report, sandboxed: decoded.sandboxed, failure: "" }); };
      onBroken = failure => { restart(failure); };
      spawned.stdin.write(encodeRequest(content, filename, mime, mode, limits));
      pump(Buffer.alloc(0));
    });
  };

  const inspect = async (
    content: Buffer,
    filename: string,
    mime: string,
    mode: string,
    limits: InspectionLimits
  ): Promise<InspectorOutcome> => {
    if (busy) return { report: null, sandboxed, failure: "procesul de inspectie are deja un job in lucru" };
    busy = true;
    try {
      return await runInspection(content, filename, mime, mode, limits);
    } finally {
      busy = false;
    }
  };

  return {
    inspect,
    stop: dispose,
    isSandboxed: () => sandboxed,
    restartCount: () => restarts
  };
}

export const __testing = { FrameReader };
