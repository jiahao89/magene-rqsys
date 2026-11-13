-- 0028（I3-3）：全局运行开关。首个用途：AI 额度耗尽时暂停自动分析入队。
-- 只存服务端控制状态，不承载业务数据；value 为 JSONB，updated_at 记录最近变更。
BEGIN;

CREATE TABLE IF NOT EXISTS system_flags (
  name text PRIMARY KEY,
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
