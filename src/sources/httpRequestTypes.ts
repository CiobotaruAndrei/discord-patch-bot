"use strict";

export interface HttpRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  data?: unknown;
  responseType?: "arraybuffer" | "json" | "text";
  largeJson?: boolean;
  maxContentLength?: number;
  maxBodyLength?: number;
  signal?: AbortSignal;
  acceptNotModified?: boolean;
  [key: string]: unknown;
}
