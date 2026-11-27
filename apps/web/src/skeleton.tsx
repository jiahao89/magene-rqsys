// 加载占位（骨架屏）：基于 Arco Skeleton，仅在“首次加载且没有旧数据”时出现；
// 静默刷新保持既有内容，避免整页闪烁。外层用 role="status" + aria-busy 表达加载中。
import { Card as ArcoCard, Grid as ArcoGrid, Skeleton as ArcoSkeleton } from "@arco-design/web-react";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <span className={`skeleton ${className}`.trim()} aria-hidden="true">
      <ArcoSkeleton animation text={{ rows: 1, width: "100%" }} />
    </span>
  );
}

export function SkeletonText({ lines = 1 }: { lines?: number }) {
  return (
    <span className="skeleton-text" role="status" aria-busy="true" aria-label="正在加载">
      <span className="skeleton" aria-hidden="true">
        <ArcoSkeleton animation text={{ rows: lines }} />
      </span>
    </span>
  );
}

type SkeletonTableProps = { rows?: number; columns?: number };

/** 表格骨架：采用 Arco Skeleton 占位行，列宽按序号轻微变化。 */
export function SkeletonTableRows({ rows = 5, columns = 5 }: SkeletonTableProps) {
  return (
    <div className="table-scroll skeleton-table" role="status" aria-busy="true" aria-label="正在加载列表">
      <table aria-hidden="true">
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((_, columnIndex) => (
                <td key={columnIndex}>
                  <span className="skeleton">
                    <ArcoSkeleton animation text={{ rows: 1, width: columnIndex === 0 ? "85%" : "60%" }} />
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-cards" role="status" aria-busy="true" aria-label="正在加载统计">
      <ArcoGrid.Row gutter={[16, 16]}>
        {Array.from({ length: count }).map((_, index) => (
          <ArcoGrid.Col key={index} xs={24} sm={12} md={Math.max(6, Math.floor(24 / Math.min(count, 4)))}>
            <ArcoCard className="skeleton skeleton-card" aria-hidden="true">
              <ArcoSkeleton animation text={{ rows: 2, width: ["45%", "75%"] }} />
            </ArcoCard>
          </ArcoGrid.Col>
        ))}
      </ArcoGrid.Row>
    </div>
  );
}

/** 需求详情骨架：摘要卡 + 评分区 + 字段区的近似结构。 */
export function RequirementDetailSkeleton() {
  return (
    <div className="req-detail-skeleton" role="status" aria-busy="true" aria-label="正在加载需求详情">
      <ArcoCard className="skeleton" aria-hidden="true">
        <ArcoSkeleton animation text={{ rows: 3, width: ["40%", "85%", "60%"] }} />
      </ArcoCard>
      <ArcoGrid.Row gutter={[16, 16]} className="req-detail-skeleton-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <ArcoGrid.Col key={index} xs={24} sm={12}>
            <ArcoCard className="skeleton skeleton-card" aria-hidden="true">
              <ArcoSkeleton animation text={{ rows: 3, width: ["45%", "90%", "70%"] }} />
            </ArcoCard>
          </ArcoGrid.Col>
        ))}
      </ArcoGrid.Row>
    </div>
  );
}
