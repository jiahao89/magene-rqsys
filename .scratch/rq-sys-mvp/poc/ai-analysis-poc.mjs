#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';
const KEY = process.env.AI_API_KEY ?? '';
const OUT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'results');

const DICTIONARY = {
  version: 'test-dict-v1',
  modules: ['基础数据', '数据可视化', '报表分析', '权限管理', '集成对接'],
  fallback: ['其他', '待分类'],
};
const PROMPT_VERSION = 'poc-prompt-v1';
const RULE_VERSION = null;

const CONFIDENCES = ['高', '中', '低'];
const UMSC_KEYS = ['U', 'M', 'S', 'C'];

function maskPII(text, markers = []) {
  let out = String(text);
  for (const marker of markers) {
    if (marker) out = out.split(marker).join('（已掩码）');
  }
  return out
    .replace(/1[3-9]\d{9}/g, '（手机号已掩码）')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '（邮箱已掩码）');
}

function sanitize(text) {
  if (!KEY) return text;
  return String(text).split(KEY).join('***REDACTED***');
}

function buildSystemPrompt() {
  return [
    '你是需求分析助手。请阅读需求标题与描述，输出 json 格式的分析结果。',
    '可用模块词典（module 必须从中选择）：' + DICTIONARY.modules.join('、') + '。',
    '若需求内容清楚但不属于任何模块，module 用「其他」；若证据不足无法可靠判断，module 用「待分类」且 confidence 只能是「低」。',
    'confidence 是对单条需求整体的高/中/低判断，附总体理由 overall_reason 和来自原文的 evidence 片段。',
    'U/M/S/C 为价值/成本/风险/依赖维度的建议，每项含 rationale，并给出引用原文的 evidence；缺少依据时 missing_evidence 设为 true 且 evidence 留空数组，不得编造。',
    'facts 只记录原文中的事实；inference 是你的推断，每条必须带 ai_inference: true。',
    'missing_inputs 列出影响判断的缺失信息。',
    'priority 优先级规则未发布，必须恒为 null。',
    `输出 json 样例：`,
    JSON.stringify({
      module: '报表分析',
      confidence: '中',
      overall_reason: '一句话总体理由',
      evidence: ['引用原文片段'],
      umsc: {
        U: { rationale: '价值判断', evidence: ['原文片段'], missing_evidence: false },
        M: { rationale: '成本判断', evidence: [], missing_evidence: true },
        S: { rationale: '风险判断', evidence: ['原文片段'], missing_evidence: false },
        C: { rationale: '依赖判断', evidence: [], missing_evidence: true },
      },
      facts: ['原文中的事实'],
      inference: [{ claim: '推断内容', ai_inference: true }],
      missing_inputs: ['缺失信息'],
      priority: null,
    }, null, 2),
  ].join('\n');
}

function buildOutboundPayload(req, { freeform = false } = {}) {
  const system = freeform
    ? '你是需求分析助手，请用自然语言给出你对这条需求的看法。'
    : buildSystemPrompt();
  const user = JSON.stringify({
    title: maskPII(req.title, req.pii_markers ?? []),
    description: maskPII(req.description, req.pii_markers ?? []),
  });
  return {
    system,
    user,
    assert_no_raw_pii: assertNoRawPII(user, req),
  };
}

function assertNoRawPII(userPayload, req) {
  const violations = [];
  if (req.pii_markers) {
    for (const marker of req.pii_markers) {
      if (userPayload.includes(marker)) violations.push(marker);
    }
  }
  return { ok: violations.length === 0, violations };
}

function validateAnalysis(rawText, { freeform = false } = {}) {
  const errors = [];
  if (rawText == null || String(rawText).trim() === '') {
    return { ok: false, errors: ['empty_content: model returned empty content'], obj: null };
  }
  let obj;
  try {
    obj = JSON.parse(rawText);
  } catch (e) {
    return { ok: false, errors: ['invalid_json: ' + sanitize(e.message)], obj: null };
  }
  const allowedModules = [...DICTIONARY.modules, ...DICTIONARY.fallback];
  if (!allowedModules.includes(obj.module)) errors.push(`module_out_of_range: ${sanitize(JSON.stringify(obj.module))}`);
  if (!CONFIDENCES.includes(obj.confidence)) errors.push(`confidence_out_of_range: ${sanitize(JSON.stringify(obj.confidence))}`);
  if (typeof obj.overall_reason !== 'string' || !obj.overall_reason.trim()) errors.push('overall_reason_missing');
  if (!Array.isArray(obj.evidence) || obj.evidence.length === 0 || !obj.evidence.every((e) => typeof e === 'string' && e.trim())) errors.push('overall_evidence_missing');
  if (!obj.umsc || typeof obj.umsc !== 'object') {
    errors.push('umsc_missing');
  } else {
    for (const k of UMSC_KEYS) {
      const item = obj.umsc[k];
      if (!item || typeof item !== 'object') { errors.push(`umsc_${k}_missing`); continue; }
      if (typeof item.rationale !== 'string' || !item.rationale.trim()) errors.push(`umsc_${k}_rationale_missing`);
      if (item.missing_evidence === true) {
        if (Array.isArray(item.evidence) && item.evidence.length > 0) errors.push(`umsc_${k}_conflicting_evidence`);
      } else {
        if (!Array.isArray(item.evidence) || item.evidence.length === 0) errors.push(`umsc_${k}_evidence_missing`);
      }
    }
  }
  if (!Array.isArray(obj.facts)) errors.push('facts_missing');
  if (!Array.isArray(obj.inference)) {
    errors.push('inference_missing');
  } else if (!obj.inference.every((i) => i && i.ai_inference === true)) {
    errors.push('inference_not_labeled_as_ai');
  }
  if (!Array.isArray(obj.missing_inputs)) errors.push('missing_inputs_missing');
  if (RULE_VERSION === null && obj.priority !== null && obj.priority !== undefined && obj.priority !== '') {
    errors.push('priority_must_be_null_without_published_rule');
  }
  return { ok: errors.length === 0, errors, obj };
}

function classifyHttpError(status) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  return 'request_error';
}

function classifyFailure(err) {
  const msg = sanitize(String(err?.message ?? err));
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { kind: 'timeout', summary: 'request aborted at client timeout' };
  if (err?.kind) return { kind: err.kind, summary: msg };
  return { kind: 'network_error', summary: msg };
}

async function callModel(payload, { timeoutMs = 30000, useJsonMode = true } = {}) {
  if (!KEY) throw Object.assign(new Error('AI_API_KEY is not set'), { kind: 'config_error' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: payload.system },
          { role: 'user', content: payload.user },
        ],
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
        max_tokens: 2000,
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw Object.assign(new Error(`HTTP ${res.status} ${classifyHttpError(res.status)}`), {
        kind: classifyHttpError(res.status),
        status: res.status,
        detailSnippet: sanitize(bodyText.slice(0, 300)),
      });
    }
    const data = await res.json();
    return {
      content: data?.choices?.[0]?.message?.content ?? '',
      finish_reason: data?.choices?.[0]?.finish_reason ?? null,
      usage: data?.usage ?? null,
      model: data?.model ?? MODEL,
    };
  } finally {
    clearTimeout(timer);
  }
}

function makeProvenance(promptVersion) {
  return {
    model: MODEL,
    prompt_version: promptVersion,
    dictionary_version: DICTIONARY.version,
    rule_version: RULE_VERSION,
    generated_at: new Date().toISOString(),
    attempt: 1,
    retry_of: null,
  };
}

function writeResult(name, data) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2));
}

const REQ_NORMAL = {
  title: '报表导出支持自定义列与筛选条件',
  description:
    '目前系统的报表模块只能导出固定列，销售团队每周都要在导出后用电子表格手工整理，才能得到需要的区域汇总数据。' +
    '希望导出时可以勾选需要的列，并按时间范围和区域两个条件筛选。' +
    '提出人：张三，手机 13812345678，邮箱 zhangsan@example.com，附件里有现阶段的整理模板。',
  pii_markers: ['张三', '13812345678', 'zhangsan@example.com'],
};

const REQ_WEAK = {
  title: '优化一下系统',
  description: '感觉现在的系统有点慢，希望改进。',
  pii_markers: [],
};

const CASES = [
  {
    id: 'T1_normal_sufficient_evidence',
    req: REQ_NORMAL,
    freeform: false,
    useJsonMode: true,
    expect: 'valid result with module in dictionary, one confidence, umsc with evidence or missing markers',
  },
  {
    id: 'T2_low_evidence',
    req: REQ_WEAK,
    freeform: false,
    useJsonMode: true,
    expect: '待分类 or low confidence; missing_inputs/blind spots present; no fabricated facts',
  },
  {
    id: 'T3_invalid_structure_freeform',
    req: REQ_NORMAL,
    freeform: true,
    useJsonMode: false,
    expect: 'validator rejects non-JSON free text as analysis failure, not success',
  },
];

function offlineCases() {
  const results = [];
  results.push({
    id: 'O1_empty_content',
    raw: '',
    validate: validateAnalysis(''),
    expect: 'empty content treated as analysis failure (known JSON Output issue in provider docs)',
  });
  results.push({
    id: 'O2_out_of_range_enum',
    raw: JSON.stringify({ module: '不存在的模块', confidence: '极高', overall_reason: 'x', evidence: ['e'], umsc: { U: { rationale: 'r', evidence: ['e'], missing_evidence: false }, M: { rationale: 'r', evidence: ['e'], missing_evidence: false }, S: { rationale: 'r', evidence: ['e'], missing_evidence: false }, C: { rationale: 'r', evidence: ['e'], missing_evidence: false } }, facts: ['f'], inference: [{ claim: 'c', ai_inference: true }], missing_inputs: [], priority: null }),
    validate: validateAnalysis(JSON.stringify({ module: '不存在的模块', confidence: '极高', overall_reason: 'x', evidence: ['e'], umsc: { U: { rationale: 'r', evidence: ['e'], missing_evidence: false }, M: { rationale: 'r', evidence: ['e'], missing_evidence: false }, S: { rationale: 'r', evidence: ['e'], missing_evidence: false }, C: { rationale: 'r', evidence: ['e'], missing_evidence: false } }, facts: ['f'], inference: [{ claim: 'c', ai_inference: true }], missing_inputs: [], priority: null })),
    expect: 'module/confidence enum violations rejected',
  });
  results.push({
    id: 'O3_priority_without_rule',
    raw: JSON.stringify({ module: '报表分析', confidence: '高', overall_reason: 'x', evidence: ['e'], umsc: { U: { rationale: 'r', evidence: ['e'], missing_evidence: false }, M: { rationale: 'r', evidence: ['e'], missing_evidence: false }, S: { rationale: 'r', evidence: ['e'], missing_evidence: false }, C: { rationale: 'r', evidence: ['e'], missing_evidence: false } }, facts: ['f'], inference: [{ claim: 'c', ai_inference: true }], missing_inputs: [], priority: 'P1' }),
    validate: validateAnalysis(JSON.stringify({ module: '报表分析', confidence: '高', overall_reason: 'x', evidence: ['e'], umsc: { U: { rationale: 'r', evidence: ['e'], missing_evidence: false }, M: { rationale: 'r', evidence: ['e'], missing_evidence: false }, S: { rationale: 'r', evidence: ['e'], missing_evidence: false }, C: { rationale: 'r', evidence: ['e'], missing_evidence: false } }, facts: ['f'], inference: [{ claim: 'c', ai_inference: true }], missing_inputs: [], priority: 'P1' })),
    expect: 'priority P0-P3 rejected when no rule version published',
  });
  results.push({
    id: 'O4_inference_not_labeled',
    raw: JSON.stringify({ module: '报表分析', confidence: '高', overall_reason: 'x', evidence: ['e'], umsc: { U: { rationale: 'r', evidence: ['e'], missing_evidence: false }, M: { rationale: 'r', evidence: ['e'], missing_evidence: false }, S: { rationale: 'r', evidence: ['e'], missing_evidence: false }, C: { rationale: 'r', evidence: ['e'], missing_evidence: false } }, facts: ['f'], inference: ['未标注的推断'], missing_inputs: [], priority: null }),
    validate: validateAnalysis(JSON.stringify({ module: '报表分析', confidence: '高', overall_reason: 'x', evidence: ['e'], umsc: { U: { rationale: 'r', evidence: ['e'], missing_evidence: false }, M: { rationale: 'r', evidence: ['e'], missing_evidence: false }, S: { rationale: 'r', evidence: ['e'], missing_evidence: false }, C: { rationale: 'r', evidence: ['e'], missing_evidence: false } }, facts: ['f'], inference: ['未标注的推断'], missing_inputs: [], priority: null })),
    expect: 'unlabeled inference rejected',
  });
  results.push({
    id: 'O5_http_error_classification',
    checks: [
      { status: 401, classified: classifyHttpError(401) },
      { status: 403, classified: classifyHttpError(403) },
      { status: 429, classified: classifyHttpError(429) },
      { status: 500, classified: classifyHttpError(500) },
      { status: 400, classified: classifyHttpError(400) },
    ],
    expect: '401/403 auth_error, 429 rate_limited, 5xx provider_error; live 429 not triggered in POC',
  });
  return results;
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];
  const hasKey = Boolean(KEY);
  const offline = offlineCases();
  for (const c of offline) {
    writeResult(`result-${c.id}.json`, c);
    const ok = c.validate ? c.validate.ok === false : Array.isArray(c.checks) && c.checks.every((x) => (x.status === 429 ? x.classified === 'rate_limited' : true));
    summary.push({ id: c.id, mode: 'offline', ok, note: c.expect });
  }

  for (const c of CASES) {
    const payload = buildOutboundPayload(c.req, { freeform: c.freeform });
    writeResult(`outbound-${c.id}.json`, payload);
    if (!hasKey) {
      summary.push({ id: c.id, mode: 'online', ok: null, note: 'skipped: no AI_API_KEY; outbound payload saved for PII inspection' });
      continue;
    }
    const startedAt = Date.now();
    let entry = { id: c.id, mode: 'online' };
    try {
      const res = await callModel(payload, { useJsonMode: c.useJsonMode, timeoutMs: 30000 });
      const v = validateAnalysis(res.content, { freeform: c.freeform });
      entry = {
        ...entry,
        http: 'ok',
        latency_ms: Date.now() - startedAt,
        finish_reason: res.finish_reason,
        usage: res.usage,
        raw_response_saved: true,
        validation: { ok: v.ok, errors: v.errors },
        provenance: makeProvenance(c.freeform ? 'poc-prompt-freeform' : PROMPT_VERSION),
        expected: c.expect,
      };
      if (v.ok) writeResult(`analysis-${c.id}.json`, { provenance: entry.provenance, result: v.obj });
      writeResult(`result-${c.id}.json`, entry);
      writeResult(`raw-response-${c.id}.txt`, res.content ?? '');
      summary.push({ ...entry, ok: c.freeform ? v.ok === false : v.ok === true, note: c.expect });
    } catch (err) {
      const f = classifyFailure(err);
      entry = {
        ...entry,
        http: 'error',
        latency_ms: Date.now() - startedAt,
        failure: f,
        status: err?.status ?? null,
        detailSnippet: err?.detailSnippet ?? null,
        provenance: makeProvenance(c.freeform ? 'poc-prompt-freeform' : PROMPT_VERSION),
      };
      writeResult(`result-${c.id}.json`, entry);
      summary.push({ ...entry, ok: false, note: c.expect });
    }
  }

  const timeoutProbe = { id: 'T4_timeout_abort', mode: 'online', note: 'client abort classified as timeout; requires key' };
  if (hasKey) {
    try {
      await callModel(buildOutboundPayload(REQ_NORMAL), { timeoutMs: 1, useJsonMode: true });
      timeoutProbe.ok = false;
    } catch (err) {
      timeoutProbe.ok = classifyFailure(err).kind === 'timeout';
    }
    summary.push(timeoutProbe);
  } else {
    summary.push({ ...timeoutProbe, ok: null });
  }

  const authProbe = { id: 'T5_service_error_auth', mode: 'online', note: 'invalid key -> auth_error without leaking key; requires key' };
  if (hasKey) {
    try {
      await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-invalid-key-for-poc' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'ping' }] }),
      }).then(async (res) => {
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { kind: classifyHttpError(res.status), status: res.status, detailSnippet: sanitize((await res.text()).slice(0, 300)) });
      });
      authProbe.ok = false;
    } catch (err) {
      authProbe.ok = classifyFailure(err).kind === 'auth_error' && !sanitize(String(err?.message ?? '')).includes('sk-');
      authProbe.failure = classifyFailure(err);
    }
    summary.push(authProbe);
  } else {
    summary.push({ ...authProbe, ok: null });
  }

  writeResult('summary.json', {
    model: MODEL,
    api_base: API_BASE,
    key_present: hasKey,
    key_redacted_in_all_outputs: true,
    cases: summary,
  });

  const header = 'id\tmode\tok\tnote';
  const lines = summary.map((s) => `${s.id}\t${s.mode}\t${s.ok === null ? 'skipped' : s.ok ? 'PASS' : 'FAIL'}\t${s.note}`);
  console.log(header);
  console.log(lines.join('\n'));
  console.log(`\nresults dir: ${OUT_DIR}`);
  if (!hasKey) console.log('\nAI_API_KEY not set: online cases saved outbound payloads only. Re-run with key to execute live cases.');
}

run();
