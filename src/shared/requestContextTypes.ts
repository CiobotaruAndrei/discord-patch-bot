"use strict";

export interface RequestContextStore {
  requestId?: string;
  abortSignal?: AbortSignal | null;
}
