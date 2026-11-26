// 共用 OpenAI 兼容 /chat/completions HTTP 客户端（根仓与妙搭仓逐字共用）。
//
// 安全与可靠性边界：
// - 单一 AbortController 定时器同时覆盖 fetch() 与响应体读取（含错误体排空与 response.json()），
//   只在 finally 里 clearTimeout，避免响应头返回后响应体挂死导致永久阻塞；
// - 非 2xx 时最多排空 4 KB 响应体以复用连接，但绝不把供应商原始正文拼进错误消息或日志，
//   只保留结构化错误类别（kind）与 HTTP 状态码（httpStatus）；
// - 不读环境变量、不隐式回落默认地址或密钥；配置校验由调用方在入口完成。

import { z } from "zod";

const ENDPOINT = "/chat/completions";
export const ERROR_BODY_DRAIN_BYTES = 4_096;

export interface OpenAiFetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAiChatCompletionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: readonly OpenAiChatMessage[];
  temperature: number | null;
  timeoutMs: number;
  fetch?: OpenAiFetchLike;
}

export type OpenAiHttpErrorKind =
  | "auth_error"
  | "rate_limited"
  | "provider_error"
  | "request_error"
  | "timeout"
  | "network_error"
  | "envelope"
  | "empty_content";

export class OpenAiHttpError extends Error {
  constructor(
    public readonly kind: OpenAiHttpErrorKind,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "OpenAiHttpError";
  }
}

const EnvelopeSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional(),
      }).passthrough(),
    }).passthrough(),
  ).min(1),
}).passthrough();

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function drainErrorBody(response: Response): Promise<void> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  let read = 0;
  try {
    while (read < ERROR_BODY_DRAIN_BYTES) {
      const { done, value } = await reader.read();
      if (done) return;
      read += value?.byteLength ?? 0;
    }
  } catch {
    // 读不动或被中断时保留原始 HTTP 状态码分类
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 流已关闭或已取消
    }
  }
}

function classifyHttpStatus(status: number): OpenAiHttpError {
  if (status === 401 || status === 403) {
    return new OpenAiHttpError("auth_error", `AI provider authentication failed (HTTP ${status}).`, status);
  }
  if (status === 429) {
    return new OpenAiHttpError("rate_limited", `AI provider rate limit reached (HTTP ${status}).`, status);
  }
  if (status >= 500) {
    return new OpenAiHttpError("provider_error", `AI provider request failed (HTTP ${status}).`, status);
  }
  return new OpenAiHttpError("request_error", `AI provider rejected the request (HTTP ${status}).`, status);
}

/**
 * 调用 OpenAI 兼容 `/chat/completions`（JSON 模式）并返回非空的 `choices[0].message.content`。
 * 所有失败统一抛出结构化 `OpenAiHttpError`，不透出供应商错误正文或密钥。
 */
export async function requestOpenAiChatContent(options: OpenAiChatCompletionOptions): Promise<string> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl}${ENDPOINT}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          ...(options.temperature === null ? {} : { temperature: options.temperature }),
          response_format: { type: "json_object" },
          messages: options.messages,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OpenAiHttpError("timeout", "AI provider request timed out.");
      }
      throw new OpenAiHttpError("network_error", "AI provider is unavailable.");
    }

    if (!response.ok) {
      await drainErrorBody(response);
      throw classifyHttpStatus(response.status);
    }

    let envelope: z.infer<typeof EnvelopeSchema>;
    try {
      envelope = EnvelopeSchema.parse(await response.json());
    } catch (error) {
      if (isAbortError(error)) {
        throw new OpenAiHttpError("timeout", "AI provider request timed out.");
      }
      throw new OpenAiHttpError("envelope", "AI provider returned an invalid response.");
    }

    const content = envelope.choices[0]?.message.content;
    if (!content?.trim()) {
      throw new OpenAiHttpError("empty_content", "AI provider returned empty content.");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
