// 工作台面板统一导出桶（向后兼容既有测试与外部导入；页面路由实际按 ./pages/* 懒加载分包）。
export { PanelErrorBoundary, PublishStatusChip, type LoadState } from "./panel-shared";
export { SourcesPanel } from "./pages/sources-page";
export { MappingsPanel, PeoplePanel, TeamPanel } from "./pages/team-page";
export { ModulesPanel } from "./pages/modules-page";
export { AuditPanel, BatchesPanel, SyncRecordsPanel } from "./pages/sync-records-page";
export { OpsPanel } from "./pages/ops-page";
export { GuidePanel } from "./pages/guide-page";
export {
  AnalysisContextSection,
  MyRequirementsPanel,
  PriorityOverrideSection,
  RecycleBinPanel,
  RequirementsPanel,
  ScoringPanel,
  processingBadge,
  requirementProcessingState,
  processingStateLabels,
  type DimensionInsight,
} from "./pages/requirements-page";
