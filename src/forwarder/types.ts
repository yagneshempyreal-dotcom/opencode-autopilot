import type { ChatCompletionRequest, ModelEntry, OpenCodeAuth } from "../types.js";

export interface ForwardInput {
  request: ChatCompletionRequest;
  model: ModelEntry;
  auth: OpenCodeAuth;
  signal?: AbortSignal;
}

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  modelUsed: ModelEntry;
}

export type Forwarder = (input: ForwardInput) => Promise<ForwardResult>;

export class ForwardError extends Error {
  constructor(public status: number, public detail: string, public retriable: boolean) {
    super(`forward ${status}: ${detail}`);
  }
}

export function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
