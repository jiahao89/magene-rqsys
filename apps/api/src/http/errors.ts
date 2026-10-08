// 安全错误 envelope：统一错误码注册表与响应构造。
// 验收标准（Ticket 04）：API 错误不回显密钥、个人敏感信息或 provider 原始敏感响应。
// 响应体形如 { error: { code, message } }，与 openapi.yaml 的错误契约一致。

// 错误码到 HTTP 状态的注册表。错误码是稳定契约，消息可调整。
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
  ROUTE_NOT_IMPLEMENTED: 501,
  DEPENDENCY_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Request validation failed.",
  UNAUTHORIZED: "Missing or invalid identity.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "Resource not found.",
  CONFLICT: "Conflicting concurrent operation.",
  INTERNAL: "An internal error occurred.",
  ROUTE_NOT_IMPLEMENTED:
    "This endpoint is defined by the API contract and will be implemented in its ticket.",
  DEPENDENCY_UNAVAILABLE: "A dependency is unavailable.",
};

// 敏感信息模式：密钥/凭据/联系方式。错误消息在输出前统一脱敏。
// 注意：UUID 等、资源标识符不是秘密，保留以维持可诊断性。
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI/DeepSeek 风格密钥
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Bearer token
  /(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|authorization|credential)s?\s*[=:]\s*\S+/gi,
  /\b1[3-9]\d{9}\b/g, // 中国大陆手机号
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // 邮箱
];

// 对消息中的疑似密钥/联系方式统一替换为 [REDACTED]。
export function redactSecrets(message: string): string {
  let redacted = message;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

// 构造错误响应体：默认消息或调用方提供的消息（自动脱敏）。
export function errorBody(code: ErrorCode, message?: string): ErrorBody {
  return {
    error: {
      code,
      message: redactSecrets(message ?? DEFAULT_MESSAGES[code]),
    },
  };
}

// 构造错误 Response。
export function jsonError(
  code: ErrorCode,
  message?: string,
  statusOverride?: number,
): Response {
  return Response.json(errorBody(code, message), {
    status: statusOverride ?? ERROR_STATUS[code],
  });
}

// provider 原始错误永不回显：统一映射为安全错误码和通用描述。
// 只保留 Error 类别信息，不透出 message/堆栈。
export function safeProviderError(error: unknown): ErrorBody {
  if (error instanceof Error) {
    return errorBody("DEPENDENCY_UNAVAILABLE", "Upstream provider request failed.");
  }
  return errorBody("INTERNAL");
}
