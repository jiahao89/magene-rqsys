// 把外部错误映射到 retry/policy 的错误类别，供 worker 决定"终态还是重试"。
//
// 动机：此前的终态判定只看尝试次数，于是认证失败、飞书字段/权限契约错误（1254xxx）、
// 请求校验失败这类**永久性**错误也会被重试 4–5 次——每次白打一次外部 API，最后报
// "Max attempts reached"，把"你配错了"伪装成"偶发失败"，掩盖真实原因。
// retry/policy 早就定义了 ErrorClass 与 NON_RETRYABLE，但没有任何调用方，这里把它接上。
//
// 只读取结构化字段（code / statusCode），不解析 message 文本。

import { AiProviderError } from "../analysis/provider.js";
import { FEISHU_PERMANENT_CODES, FeishuApiError } from "../base/transport.js";
import { TeambitionApiError } from "../adapters/teambition/client.js";
import type { ErrorClass } from "../retry/policy.js";

export function classifyJobError(error: unknown): ErrorClass {
  if (error instanceof AiProviderError) {
    switch (error.code) {
      case "auth_error": return "auth";
      case "request_error": return "validation";
      case "rate_limited": return "rate_limited";
      case "timeout": return "network";
      case "network_error": return "network";
      case "provider_error": return "provider_5xx";
      default: return "unknown";
    }
  }
  if ((error as Error)?.name === "BasePushPermanentError") return "validation";
  if (error instanceof FeishuApiError) {
    if (error.kind === "api" && error.apiCode !== undefined && FEISHU_PERMANENT_CODES.has(error.apiCode)) return "validation";
    if (error.kind === "invalid_response" || error.kind === "ambiguous_response") return "validation";
    const status = error.httpStatus;
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limited";
    if (status !== undefined && status >= 400 && status < 500) return "provider_4xx";
    if (status !== undefined && status >= 500) return "provider_5xx";
    return "unknown";
  }
  if (error instanceof TeambitionApiError) {
    const status = error.statusCode;
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limited";
    if (status !== null && status >= 400 && status < 500) return "provider_4xx";
    if (status !== null && status >= 500) return "provider_5xx";
    return "unknown";
  }
  return "unknown";
}
