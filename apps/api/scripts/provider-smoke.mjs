// 临时冒烟脚本：验证生产 provider 路径（验证后删除，不提交）
import { createDeepSeekProvider } from "../src/analysis/provider.js";

const provider = createDeepSeekProvider();
try {
  const result = await provider.analyze({
    title: "报表导出支持自定义列与筛选条件",
    description: "销售团队每周导出报表后需手工整理才能得到区域汇总数据，希望导出时可以勾选需要的列，并按时间范围和区域两个条件筛选。",
    context: "",
    piiMarkers: [],
    dictionary: { version: 1, modules: ["基础数据", "数据可视化", "报表分析", "权限管理", "集成对接"] },
    priorityRule: null,
  });
  const summary = {
    module: result.module,
    confidence: result.confidence,
    priority: result.priority,
    evidenceCount: result.evidence?.length ?? 0,
    inferenceLabeled: (result.inferences ?? []).every((i) => i?.ai_inference === true),
    factsCount: result.facts?.length ?? 0,
    blindSpotsCount: result.blind_spots?.length ?? 0,
  };
  console.log("SMOKE-OK " + JSON.stringify(summary));
} catch (error) {
  console.log("SMOKE-FAIL " + (error?.code ?? "?") + " :: " + (error?.message ?? String(error)));
}
