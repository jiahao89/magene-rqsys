/**
 * 通知按钮深链：`<工作台地址>?requirement=<requirements.id>`。
 *
 * 只负责解析，不校验需求是否存在：
 * - 参数缺失、空值、纯空白 → null，工作台保持默认首页行为；
 * - 编码与多余参数交给 URLSearchParams 处理，重复参数取第一个。
 * 目标需求不存在时由现有详情加载路径给出可恢复提示，不在解析层抛错。
 */
export function readRequirementDeepLink(search: string): string | null {
  const value = new URLSearchParams(search).get("requirement")?.trim();
  return value ? value : null;
}
