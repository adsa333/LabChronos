import { parseDiagnosisContent } from "./diagnosis.ts";
import { SYSTEM_PROMPT } from "./prompts/diagnose.ts";

const MAX_IMAGE_BASE64_LENGTH = 4 * 1024 * 1024;
const MAX_LOG_LENGTH = 15_000;
const MAX_BODY_BYTES = MAX_IMAGE_BASE64_LENGTH + 128 * 1024;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const DOMAIN_HINTS = ["AI/ML", "Bio/Chem", "Physics/EE", "General"] as const;

type DomainHint = typeof DOMAIN_HINTS[number];
type Fetcher = typeof fetch;

type VaultDatabase = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (count: number) => PromiseLike<{ data: unknown[] | null; error: unknown | null }>;
    };
  };
};

type HandlerOptions = {
  db?: VaultDatabase;
  env?: (name: string) => string | undefined;
  fetch?: Fetcher;
};

type DiagnoseInput = {
  imageDataUrl?: string;
  logText?: string;
  domainHint?: DomainHint;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
};

class RequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(error: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "no-store", ...Object.fromEntries(new Headers(headers)) },
  });
}

function routePath(pathname: string): string | null {
  if (pathname.startsWith("/api/")) return pathname;
  const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/api\/.*)$/);
  return match?.[1] ?? null;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestError(400, "invalid_input");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RequestError(413, "payload_too_large");
  }
  if (!request.body) throw new RequestError(400, "invalid_input");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(value)) throw new RequestError(400, "invalid_input");
    return value;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "invalid_input");
  }
}

function parseImage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new RequestError(400, "invalid_input");

  const dataUrl = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
  const mimeType = dataUrl?.[1] ?? "image/jpeg";
  const base64 = dataUrl?.[2] ?? value;
  if (
    base64.length === 0 ||
    base64.length > MAX_IMAGE_BASE64_LENGTH ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new RequestError(400, "invalid_input");
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const decodedBytes = base64.length / 4 * 3 - padding;
  if (decodedBytes <= 0 || decodedBytes > 4 * 1024 * 1024) throw new RequestError(413, "payload_too_large");
  return `data:${mimeType};base64,${base64}`;
}

async function validateDiagnoseInput(request: Request): Promise<DiagnoseInput> {
  const body = await readJsonBody(request);
  const imageDataUrl = parseImage(body.imageBase64);

  if (body.logText !== undefined && typeof body.logText !== "string") throw new RequestError(400, "invalid_input");
  const logText = typeof body.logText === "string" ? body.logText : undefined;
  if (logText && logText.length > MAX_LOG_LENGTH) throw new RequestError(413, "payload_too_large");

  if (body.domainHint !== undefined && !DOMAIN_HINTS.includes(body.domainHint as DomainHint)) {
    throw new RequestError(400, "invalid_input");
  }
  const domainHint = body.domainHint as DomainHint | undefined;
  if (!imageDataUrl && !logText?.trim()) throw new RequestError(400, "invalid_input");
  return { imageDataUrl, logText, domainHint };
}

function visionConfig(env: (name: string) => string | undefined) {
  const apiKey = env("VISION_API_KEY");
  const baseUrl = env("VISION_BASE_URL");
  const model = env("VISION_MODEL");
  if (!apiKey?.trim() || !baseUrl?.trim() || !model?.trim()) return null;

  try {
    const parsedBase = new URL(baseUrl);
    if (!["https:", "http:"].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
      return null;
    }
    return {
      apiKey,
      model,
      endpoint: `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    };
  } catch {
    return null;
  }
}

async function callModel(
  messages: ChatMessage[],
  config: NonNullable<ReturnType<typeof visionConfig>>,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<string> {
  const disableThinking = config.endpoint.includes("aliyuncs.com") || /qwen3/i.test(config.model);
  const response = await fetcher(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
      ...(disableThinking ? { enable_thinking: false } : {}),
    }),
    signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("upstream_http_error");
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new Error("upstream_invalid_response");
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
    throw new Error("upstream_invalid_response");
  }
  return choice.message.content;
}

export function createHandler(options: HandlerOptions = {}) {
  const env = options.env ?? ((name: string) => Deno.env.get(name));
  const fetcher = options.fetch ?? globalThis.fetch;
  const rateLimits = new Map<string, { count: number; resetAt: number }>();

  function retryAfter(request: Request): number {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
    const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
    const now = Date.now();
    const current = rateLimits.get(ip);
    if (!current || current.resetAt <= now) {
      rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return 0;
    }
    if (current.count >= RATE_LIMIT) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    current.count += 1;
    return 0;
  }

  return async (request: Request): Promise<Response> => {
    try {
      const path = routePath(new URL(request.url).pathname);
      if (!path) return errorResponse("not_found", 404);

      if (path === "/api/health") {
        if (request.method !== "GET") return errorResponse("method_not_allowed", 405, { allow: "GET" });
        const configured = ["VISION_API_KEY", "VISION_BASE_URL", "VISION_MODEL"].every((name) => Boolean(env(name)?.trim()));
        return Response.json({ ok: true, configured }, { headers: { "cache-control": "no-store" } });
      }

      if (path === "/api/vault-test") {
        if (request.method !== "GET") return errorResponse("method_not_allowed", 405, { allow: "GET" });
        if (!options.db) return errorResponse("database_not_configured", 503);
        try {
          const result = await options.db.from("vault_probe").select("id").limit(1);
          if (result.error || !Array.isArray(result.data)) return errorResponse("vault_probe_unavailable", 503);
          return Response.json({ ok: true, read: true, writeConfigured: true }, { headers: { "cache-control": "no-store" } });
        } catch {
          return errorResponse("vault_probe_unavailable", 503);
        }
      }

      if (path !== "/api/diagnose") return errorResponse("not_found", 404);
      if (request.method !== "POST") return errorResponse("method_not_allowed", 405, { allow: "POST" });

      const config = visionConfig(env);
      if (!config) return errorResponse("service_not_configured", 503);

      const retryAfterSeconds = retryAfter(request);
      if (retryAfterSeconds > 0) {
        return errorResponse("rate_limit_exceeded", 429, { "retry-after": String(retryAfterSeconds) });
      }

      const input = await validateDiagnoseInput(request);
      const text = [
        input.domainHint ? `实验领域提示：${input.domainHint}` : "实验领域提示：未提供，请依据材料判断。",
        input.logText?.trim() ? `实验日志：\n${input.logText}` : "实验日志：未提供。",
        input.imageDataUrl ? "已提供实验图像，请结合图像与上述材料取证。" : "未提供实验图像，请仅依据日志取证。",
      ].join("\n\n");
      const userContent: ChatMessage["content"] = [
        { type: "text", text },
        ...(input.imageDataUrl ? [{ type: "image_url" as const, image_url: { url: input.imageDataUrl } }] : []),
      ];
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ];

      const diagnosisStartedAt = Date.now();
      let content: string;
      try {
        content = await callModel(messages, config, fetcher, 25_000);
      } catch {
        return errorResponse("diagnosis_upstream_failed", 502);
      }

      let parsed = parseDiagnosisContent(content);
      const elapsedMs = Date.now() - diagnosisStartedAt;
      if (!parsed.ok && elapsedMs < 18_000) {
        const retryMessages: ChatMessage[] = [
          ...messages,
          { role: "assistant", content },
          {
            role: "user",
            content: `上次结果未通过契约校验：${parsed.feedback}\n请修复全部问题并只返回合法 JSON，不要解释。`,
          },
        ];
        try {
          content = await callModel(retryMessages, config, fetcher, Math.max(5_000, Math.round(29_500 - elapsedMs)));
          parsed = parseDiagnosisContent(content);
        } catch {
          return errorResponse("diagnosis_parse_failed", 502);
        }
      }

      if (!parsed.ok) return errorResponse("diagnosis_parse_failed", 502);
      return Response.json(parsed.data, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof RequestError) return errorResponse(error.code, error.status);
      return errorResponse("internal_error", 500);
    }
  };
}
