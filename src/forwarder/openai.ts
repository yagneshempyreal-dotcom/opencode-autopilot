import { bearerToken, getCredential } from "../config/auth.js";
import type { ForwardInput, ForwardResult } from "./types.js";
import { ForwardError } from "./types.js";

export async function forwardOpenAICompat(input: ForwardInput): Promise<ForwardResult> {
  const { request, model, auth, signal } = input;
  const cred = getCredential(auth, model.provider);
  const token = bearerToken(cred);
  if (!token && model.provider !== "opencode") {
    throw new ForwardError(401, `no credentials for ${model.provider}`, false);
  }

  const baseURL = model.baseURL;
  if (!baseURL) throw new ForwardError(500, `no baseURL for ${model.provider}`, false);

  const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: request.stream ? "text/event-stream" : "application/json",
  };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const body = { ...request, model: model.modelID };

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
    body: res.body ?? "",
    modelUsed: model,
  };
}
