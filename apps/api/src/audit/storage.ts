// 审计存储端口：定义事件追加和查询接口。
// 持久化实现在目标 Miaoda 数据库验证后接入；本地测试使用 InMemoryAuditStorage。

import type { AuditEvent } from "./event.js";

export interface AuditStorage {
  // 追加一条审计事件。追加只读：已写入的事件不可修改或删除。
  append(event: AuditEvent): Promise<void>;

  // 按对象标识查询事件（按时间升序）。
  findByObject(object: string): Promise<AuditEvent[]>;
}

export class InMemoryAuditStorage implements AuditStorage {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async findByObject(object: string): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.object === object)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}
