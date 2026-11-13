// CSV 导出（I3-2）：统一转义与公式注入防护。
// 细节：逗号/引号/换行按 RFC 4180 加引号；以 = + - @ 或制表符/回车开头的单元格前置单引号，
// 避免 Excel / Google Sheets 把用户文本当作公式执行。

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}
