import { bearerToken, getCredential } from "../config/auth.js";
import type { ChatMessage } from "../types.js";
import type { ForwardInput, ForwardResult } from "./types.js";
import { ForwardError } from "./types.js";

const ANTHROPIC_VERSION = "2023-06-01";

export async function forwardAnthropic(input: ForwardInput): Promise<ForwardResult> {
  const { request, model, auth, signal } = input;
  const cred = getCredential(auth, model.provider);
  const token = bearerToken(cred);
  if (!token) throw new ForwardError(401, `no credentials for ${model.provider}`, false);

  const baseURL = model.baseURL ?? "https://api.anthropic.com/v1";
  const url = `${baseURL.replace(/\/$/, "")}/messages`;

  const { system, messages } = splitSystem(request.messages);
  const isOAuth = cred?.type === "oauth";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    accept: request.stream ? "text/event-stream" : "application/json",
  };
  if (isOAuth) headers["authorization"] = `Bearer ${token}`;
  else headers["x-api-key"] = token;

  const body = {
    model: model.modelID,
    messages,
    system: system || undefined,
    max_tokens: request.max_tokens ?? 4096,
    temperature: request.temperature,
    top_p: request.top_p,
    stream: request.stream ?? false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "content-encoding" && k.toLowerCase() !== "transfer-encoding") {
      responseHeaders[k] = v;
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const retriable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new ForwardError(res.status, text.slice(0, 500), retriable);
  }

  return {
    status: res.status,
    headers: responseHeaders,
    body: res.body,
    modelUsed: model,
  };
}

function splitSystem(messages: ChatMessage[]): { system: string; messages: ChatMessage[] } {
  const sys: string[] = [];
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const txt = typeof m.content === "string" ? m.content : (m.content ?? []).map((p) => p.text ?? "").join("\n");
      sys.push(txt);
    } else if (m.role === "tool") {
      out.push({ role: "user", content: typeof m.content === "string" ? m.content : "" });
    } else {
      out.push(m);
    }
  }
  return { system: sys.join("\n\n"), messages: out };
}
