// 加载占位（骨架屏）：仅在“首次加载且没有旧数据”时出现；静默刷新保持既有内容，避免整页闪烁。
// 所有骨架节点对辅助技术隐藏，外层用 role="status" + aria-busy 表达加载中。

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />;
}

export function SkeletonText({ lines = 1 }: { lines?: number }) {
  return (
    <span className="skeleton-text" role="status" aria-busy="true" aria-label="正在加载">
      {Array.from({ length: lines }).map((_, index) => (
        <span key={index} className="skeleton skeleton-line" aria-hidden="true" />
      ))}
    </span>
  );
}

type SkeletonTableProps = { rows?: number; columns?: number };

/** 表格骨架：列宽按序号轻微变化，避免整齐得像真实数据。 */
export function SkeletonTableRows({ rows = 5, columns = 5 }: SkeletonTableProps) {
  return (
    <div className="table-scroll skeleton-table" role="status" aria-busy="true" aria-label="正在加载列表">
      <table aria-hidden="true">
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((_, columnIndex) => (
                <td key={columnIndex}>
                  <span className={`skeleton skeleton-line ${columnIndex === 0 ? "skeleton-line-wide" : ""}`} />
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
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton skeleton-card" aria-hidden="true">
          <span className="skeleton skeleton-line skeleton-line-short" />
          <span className="skeleton skeleton-line skeleton-line-title" />
        </div>
      ))}
    </div>
  );
}

/** 需求详情骨架：摘要卡 + 评分区 + 字段区的近似结构。 */
export function RequirementDetailSkeleton() {
  return (
    <div className="req-detail-skeleton" role="status" aria-busy="true" aria-label="正在加载需求详情">
      <span className="skeleton skeleton-line skeleton-line-title" />
      <span className="skeleton skeleton-line skeleton-line-wide" />
      <div className="req-detail-skeleton-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton skeleton-card">
            <span className="skeleton skeleton-line skeleton-line-short" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line skeleton-line-wide" />
          </div>
        ))}
      </div>
    </div>
  );
}
