// 审计存储端口：定义事件追加和查询接口。
// 持久化实现在目标 Miaoda 数据库验证后接入；本地测试使用 InMemoryAuditStorage。
// 事件模型与 audit/event.ts（DDL 对齐的 AuditEventRecord）单一模型一致。

import type { AuditEventRecord } from "../domain/persistence.js";

export interface AuditStorage {
  // 追加一条审计事件。追加只读：已写入的事件不可修改或删除。
  append(event: AuditEventRecord): Promise<void>;

  // 按实体标识查询事件（按时间升序）。
  findByEntity(entityType: string, entityId: string): Promise<AuditEventRecord[]>;
}

export class InMemoryAuditStorage implements AuditStorage {
  private readonly events: AuditEventRecord[] = [];

  async append(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }

  async findByEntity(entityType: string, entityId: string): Promise<AuditEventRecord[]> {
    return this.events
      .filter((e) => e.entityType === entityType && e.entityId === entityId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}
