from pathlib import Path
from html import escape


OUT = Path(__file__).parent
PAPER = "#f5f5f5"
PAPER2 = "#ececec"
INK = "#2d3142"
MUTED = "#4f5d75"
SOFT = "#7a8399"
RULE = "rgba(45,49,66,0.16)"
ACCENT = "#eb6c36"
ACCENT_TINT = "rgba(235,108,54,0.08)"
LINK = "#2e5aa8"
FONT = "Geist, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif"
MONO = "'Geist Mono', 'Noto Sans Mono CJK SC', monospace"


def text(x, y, value, size=14, color=INK, weight=400, anchor="middle", family=FONT):
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{color}" '
            f'font-family="{family}" font-size="{size}" font-weight="{weight}">{escape(value)}</text>')


def multiline(x, y, lines, size=13, color=INK, weight=400, anchor="middle", leading=20, family=FONT):
    out = [f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{color}" '
           f'font-family="{family}" font-size="{size}" font-weight="{weight}">']
    for i, line in enumerate(lines):
        out.append(f'<tspan x="{x}" dy="{0 if i == 0 else leading}">{escape(line)}</tspan>')
    out.append('</text>')
    return ''.join(out)


def start_svg(slug, title, desc, subtitle, height=720):
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 {height}" role="img" aria-labelledby="{slug}-title {slug}-desc">']
    s.append(f'<title id="{slug}-title">{escape(title)}</title>')
    s.append(f'<desc id="{slug}-desc">{escape(desc)}</desc>')
    s.append(f'''<defs>
      <marker id="{slug}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="{MUTED}"/></marker>
      <marker id="{slug}-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="{ACCENT}"/></marker>
      <marker id="{slug}-arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="{LINK}"/></marker>
      <marker id="{slug}-arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0,8 3,0 6" fill="none" stroke="{MUTED}" stroke-width="1.2"/></marker>
    </defs>''')
    s.append(f'<style>text{{font-kerning:normal}} .hairline{{stroke:{RULE};stroke-width:1}} .zone{{fill:rgba(45,49,66,0.018);stroke:rgba(45,49,66,0.14);stroke-width:1;stroke-dasharray:4 4}}</style>')
    s.append(text(48, 48, title, 28, INK, 600, 'start'))
    s.append(text(48, 80, subtitle, 16, MUTED, 400, 'start'))
    s.append(f'<line x1="48" y1="96" x2="1232" y2="96" stroke="{RULE}" stroke-width="1"/>')
    return s


def end_svg(s):
    s.append('</svg>')
    return ''.join(s)


def box(x, y, w, h, title, sub=(), kind='backend', title_size=16, sub_size=12, tag=None):
    if kind == 'focal':
        fill, stroke = ACCENT_TINT, ACCENT
    elif kind == 'external':
        fill, stroke = 'rgba(45,49,66,0.03)', 'rgba(45,49,66,0.42)'
    elif kind == 'store':
        fill, stroke = 'rgba(45,49,66,0.05)', MUTED
    elif kind == 'optional':
        fill, stroke = 'rgba(45,49,66,0.02)', 'rgba(45,49,66,0.36)'
    else:
        fill, stroke = '#ffffff', INK
    dash = ' stroke-dasharray="4 3"' if kind == 'optional' else ''
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{dash}/>']
    if tag:
        tw = max(42, len(tag) * 8 + 16)
        out.append(f'<rect x="{x+12}" y="{y+10}" width="{tw}" height="20" rx="2" fill="{PAPER}" stroke="{stroke}" stroke-opacity=".4" stroke-width=".8"/>')
        out.append(text(x+12+tw/2, y+24, tag, 12, MUTED, 500, family=MONO))
        ty = y + 48
    elif sub:
        ty = y + h/2 - (len(sub)*8)
    else:
        ty = y + h/2 + 5
    out.append(text(x+w/2, ty, title, title_size, INK, 600))
    for i, line in enumerate(sub):
        out.append(text(x+w/2, ty+20+(i*18), line, sub_size, MUTED, 400))
    return ''.join(out)


def pill(x, y, w, h, value):
    return f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="{PAPER2}" stroke="{MUTED}" stroke-width="1"/>' + text(x+w/2, y+h/2+5, value, 16, INK, 600)


def diamond(cx, cy, w, h, title, sub=None):
    pts = f'{cx},{cy-h/2} {cx+w/2},{cy} {cx},{cy+h/2} {cx-w/2},{cy}'
    out = [f'<polygon points="{pts}" fill="#ffffff" stroke="{INK}" stroke-width="1"/>', text(cx, cy-2, title, 12, INK, 600)]
    if sub:
        out.append(text(cx, cy+16, sub, 11, MUTED, 400))
    return ''.join(out)


def line(x1, y1, x2, y2, slug, label=None, style='normal', label_pos=None):
    stroke = ACCENT if style == 'accent' else LINK if style == 'link' else MUTED
    marker = 'arrow-accent' if style == 'accent' else 'arrow-link' if style == 'link' else 'arrow-open' if style == 'async' else 'arrow'
    dash = ' stroke-dasharray="5 4"' if style in ('return', 'async', 'optional') else ''
    width = '1.4' if style == 'accent' else '1.1'
    s = f'<path d="M{x1},{y1} L{x2},{y2}" fill="none" stroke="{stroke}" stroke-width="{width}"{dash} marker-end="url(#{slug}-{marker})"/>'
    if label:
        lx, ly = label_pos or ((x1+x2)/2, (y1+y2)/2-10)
        tw = max(44, len(label)*14+12)
        s += f'<rect x="{lx-tw/2}" y="{ly-16}" width="{tw}" height="16" rx="2" fill="{PAPER}"/>'
        s += text(lx, ly, label, 12, MUTED, 500)
    return s


def path(d, slug, style='normal'):
    stroke = ACCENT if style == 'accent' else LINK if style == 'link' else MUTED
    marker = 'arrow-accent' if style == 'accent' else 'arrow-link' if style == 'link' else 'arrow-open' if style == 'async' else 'arrow'
    dash = ' stroke-dasharray="5 4"' if style in ('return', 'async', 'optional') else ''
    width = '1.4' if style == 'accent' else '1.1'
    return f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{width}"{dash} marker-end="url(#{slug}-{marker})"/>'


def arrow_label(cx, y, label, w=None):
    w = w or max(48, len(label)*14+12)
    return f'<rect x="{cx-w/2}" y="{y-20}" width="{w}" height="16" rx="2" fill="{PAPER}"/>' + text(cx, y-4, label, 12, MUTED, 500)


def write(slug, svg):
    svg_text = end_svg(svg)
    (OUT / f'{slug}.svg').write_text(svg_text, encoding='utf-8')


def mvp_flow():
    slug = 'mvp-flow'
    s = start_svg(slug, 'MVP｜TB 同步、AI 分析与推送流程', '定时或手动拉取 Teambition 需求并保存中间状态，完成 AI 分析后自动推送至飞书多维表格；负责人未匹配时先人工选择飞书用户。PM 后续处理状态仅维护在多维表格。', 'Web 状态：已同步 → 已分析 → 已推送；负责人未匹配时转人工选择', height=820)
    s += line(640, 150, 640, 166, slug, style='accent')
    s += line(640, 222, 640, 238, slug)
    s += line(640, 294, 640, 310, slug)
    s += line(640, 366, 640, 382, slug, style='accent')
    s += line(640, 438, 640, 440, slug, style='accent')
    s += line(640, 516, 640, 548, slug, style='accent')
    s += line(640, 604, 640, 620, slug, style='link')
    s += line(640, 682, 640, 698, slug)
    s += path('M726,478 H914', slug, 'optional')
    s += path('M1058,520 V576 H864', slug, 'link')
    s += arrow_label(824, 472, '未匹配')
    s += arrow_label(1058, 560, '选定负责人后推送', 150)
    s += arrow_label(640, 538, '已匹配')
    s += pill(560, 110, 160, 40, '开始')
    s += box(416, 166, 448, 56, '触发同步任务', ['每周定时同步 / 管理员手动同步'], title_size=16)
    s += box(416, 238, 448, 56, '拉取 TB 新增与变更需求', ['按配置项目和范围读取原始需求'], title_size=16)
    s += box(416, 310, 448, 56, '保存原文与处理元数据', ['批次、来源 ID、各阶段状态；按需求 ID 去重'], kind='store', title_size=16)
    s += box(416, 382, 448, 56, 'AI 分析需求', ['初步分类、优先级建议、依据与置信度；低置信不阻断'], kind='focal', title_size=16)
    s += diamond(640, 478, 172, 76, '负责人已匹配？')
    s += box(914, 440, 288, 80, '人工选择飞书负责人', ['Web 使用飞书用户选择器', '确认后手动触发推送'], kind='optional', title_size=15)
    s += box(416, 548, 448, 56, '推送至飞书多维表格', ['按 TB 需求 ID 幂等新增 / 更新；写入 AI 与负责人字段'], title_size=16, kind='store')
    s += box(416, 620, 448, 62, '多维表格自动化通知干系人', ['仅推送成功后触发；避免重复通知'], title_size=15)
    s += box(416, 698, 448, 56, 'PM 后续处理在多维表格维护', ['待处理 / 已采纳 / 已调整 / 暂不处理；不回写 Web'], title_size=15)
    s += text(48, 794, '低置信度或暂不处理均不阻断推送；Web 展示推送进度，PM 处理状态以多维表格为准。', 12, MUTED, 400, 'start')
    write(slug, s)


def mvp_arch():
    slug = 'mvp-architecture'
    s = start_svg(slug, 'MVP｜系统功能架构', '中间件负责计划与手动拉取、保存处理元数据、AI 分析、负责人匹配和幂等推送；飞书多维表格承载 PM 后续处理状态，并通过自动化通知干系人。', '职责边界：TB 是原始需求来源；Web 管同步与推送状态；多维表格管 PM 处理状态')
    s.append('<rect class="zone" x="48" y="144" width="224" height="424" rx="8"/>')
    s.append('<rect class="zone" x="288" y="120" width="608" height="472" rx="8"/>')
    s.append('<rect class="zone" x="912" y="144" width="320" height="424" rx="8"/>')
    s.append(f'<rect x="64" y="148" width="132" height="20" rx="2" fill="{PAPER}"/>'+text(130,164,'SOURCE',10,MUTED,500,family=MONO))
    s.append(f'<rect x="304" y="124" width="196" height="20" rx="2" fill="{PAPER}"/>'+text(402,140,'WEB / MIDDLEWARE',10,MUTED,500,family=MONO))
    s.append(f'<rect x="928" y="148" width="188" height="20" rx="2" fill="{PAPER}"/>'+text(1022,164,'FEISHU WORKFLOW',10,MUTED,500,family=MONO))
    s += path('M252,326 H320', slug, 'link')
    s += path('M438,232 V292', slug)
    s += path('M556,340 H604 V210 H620', slug, 'link')
    s += path('M740,248 V292', slug, 'accent')
    s += path('M860,340 H944', slug, 'link')
    s += path('M1076,372 V410', slug, 'async')
    s += path('M1076,488 V512', slug, 'async')
    s += box(64, 286, 188, 80, 'Teambition', ['项目需求 · 原始负责人', '新增 / 变更记录'], kind='external', title_size=16)
    s += box(320, 160, 236, 72, 'Web 工作台 / 定时调度', ['每周自动 / 手动触发', '查看各阶段状态'], title_size=15)
    s += box(320, 292, 236, 96, '同步与任务编排', ['保存原文快照、批次和状态', '失败分阶段重试'], kind='store', title_size=15)
    s += box(620, 160, 240, 88, 'AI 分析服务', ['分类 / 优先级建议', '依据、置信度；低置信不阻断'], kind='focal', title_size=15)
    s += box(620, 292, 240, 96, '负责人匹配', ['自动匹配飞书用户', '未匹配由操作人手动选择'], title_size=15)
    s += box(944, 276, 264, 96, '飞书多维表格', ['TB 原文 / AI 建议 / 负责人', 'PM 处理状态分字段保存'], kind='store', title_size=15)
    s += box(944, 410, 264, 78, '多维表格自动化', ['推送成功后通知干系人'], kind='focal', title_size=15)
    s += box(944, 512, 264, 56, '干系人 / PM', ['PM 状态只在表格更新'], kind='external', title_size=14)
    s += text(48, 630, 'Web 不回读 PM 处理结论；待处理 / 已采纳 / 已调整 / 暂不处理由多维表格维护。', 12, MUTED, 400, 'start')
    write(slug, s)


def sequence():
    slug = 'mvp-sequence'
    s = start_svg(slug, 'MVP｜同步、AI 分析与推送时序', '定时或手动触发 TB 拉取，经过分析与负责人匹配后推送多维表格，通知由表格自动化发出；PM 后续处理状态只写多维表格。', '低置信度不阻断推送；负责人未匹配时由操作人在 Web 选择后再触发推送')
    actors = [(128, '定时任务 / 管理员'), (384, 'Web 工作台'), (640, '同步后端'), (896, 'TB API'), (1152, '飞书 Base / 自动化')]
    top, bottom = 116, 652
    # lifelines and actor boxes
    for i, (cx, label) in enumerate(actors):
        s.append(f'<line x1="{cx}" y1="160" x2="{cx}" y2="{bottom}" stroke="{RULE}" stroke-width="1" stroke-dasharray="4 4"/>')
        kind = 'focal' if i == 2 else 'backend'
        s += box(cx-100, top, 200, 44, label, (), kind=kind, title_size=12)
    # actor activation bars
    for cx, y1, y2 in [(384,188,510),(640,214,594),(896,250,342),(1152,420,574)]:
        s.append(f'<rect x="{cx-4}" y="{y1}" width="8" height="{y2-y1}" fill="rgba(45,49,66,0.06)" stroke="{MUTED}" stroke-width=".8"/>')
    rows = [194,230,266,302,338,374,410,446,482,526,570,614]
    def msg(src, dst, y, label, style='normal'):
        stroke = ACCENT if style=='accent' else MUTED if style=='return' else LINK if style=='link' else MUTED
        marker = 'arrow-accent' if style=='accent' else 'arrow-link' if style=='link' else 'arrow-open' if style=='async' else 'arrow'
        dash = ' stroke-dasharray="5 4"' if style in ('return', 'async') else ''
        direction = 1 if dst>src else -1
        startx, endx = src+direction*8, dst-direction*8
        s.append(f'<path d="M{startx},{y} H{endx}" fill="none" stroke="{stroke}" stroke-width="{1.3 if style=="accent" else 1}"{dash} marker-end="url(#{slug}-{marker})"/>')
        mid=src+direction*min(abs(dst-src)/2, 128)
        # opaque label mask with a visible gap above its connector
        tw=max(120,len(label)*12+20)
        s.append(f'<rect x="{mid-tw/2}" y="{y-28}" width="{tw}" height="16" rx="2" fill="{PAPER}"/>')
        s.append(text(mid,y-16,label,12,MUTED,500))
    def selfcall(cx, y, label, style='normal'):
        stroke = ACCENT if style == 'accent' else MUTED
        marker = 'arrow-accent' if style == 'accent' else 'arrow'
        s.append(f'<path d="M{cx},{y} H{cx+46} Q{cx+54},{y} {cx+54},{y+8} V{y+14} Q{cx+54},{y+22} {cx+46},{y+22} H{cx}" fill="none" stroke="{stroke}" stroke-width="1.2" marker-end="url(#{slug}-{marker})"/>')
        tx = cx-402 if cx > 900 else cx+68
        s.append(f'<rect x="{tx-6}" y="{y-4}" width="340" height="20" rx="2" fill="{PAPER}"/>')
        s.append(text(tx,y+10,label,12,MUTED,500,'start'))
    msg(128,384,rows[0],'每周定时任务或管理员手动触发')
    msg(384,640,rows[1],'提交项目与同步范围')
    msg(640,896,rows[2],'增量读取 TB 新增 / 变更需求', 'link')
    msg(896,640,rows[3],'返回原文、需求 ID 与负责人标识', 'return')
    selfcall(640,rows[4],'保存原文快照、批次和同步状态')
    selfcall(640,rows[5],'调用 AI 并保存分类 / 优先级建议与置信度','accent')
    msg(640,384,rows[6],'更新已同步 / 已分析进度', 'return')
    msg(128,384,rows[7],'为未匹配记录选择飞书负责人')
    msg(384,640,rows[8],'负责人确认后触发推送')
    msg(640,1152,rows[9],'按需求 ID 幂等推送原文 / AI / 负责人', 'accent')
    selfcall(1152,rows[10],'推送成功后自动化通知干系人')
    msg(128,1152,rows[11],'PM 更新采纳 / 调整 / 暂不处理状态')
    s.append(f'<line x1="48" y1="674" x2="1232" y2="674" stroke="{RULE}" stroke-width="1"/>')
    s.append(text(48,700,'Web 最终记录“已推送”；PM 处理结果仅在多维表格维护，不回写 Web。',12,MUTED,400,'start'))
    write(slug, s)


def roadmap_flow():
    slug = 'roadmap-flow'
    s = start_svg(slug, 'Roadmap｜完整需求闭环流程', '完整版本从多来源需求进入，经规则校验与 AI 辅助补充、分析与人工决策，进入执行验证，再用 VOC/NPS 信号触发未关闭需求复评。虚拟用户推演仅作假设。', '迭代 1：录入与分配 → 迭代 2：分析与决策 → 迭代 3：执行与验证 → 迭代 4：VOC / NPS')
    # Stages form a top-down process; one dashed feedback path returns VOC/NPS signals to analysis.
    s += line(640, 140, 640, 152, slug, style='accent')
    s += line(640, 224, 640, 248, slug, style='accent')
    s += line(640, 336, 640, 364, slug)
    s += line(640, 452, 640, 480, slug)
    s += path('M860,520 H980 Q988,520 988,512 V300 Q988,292 980,292 H860', slug, 'optional')
    s += arrow_label(1096, 416, 'VOC / NPS 触发复评', 176)
    # Start and stage nodes
    s += pill(560, 104, 160, 40, '多来源需求进入')
    s += box(420, 152, 440, 72, '迭代 1｜需求录入与分配', ['飞书表单 / Teambition · 必填校验', 'AI 完整性检查、改写与补充问题；推荐 PM 后人工确认'], title_size=16)
    s += box(420, 248, 440, 88, '迭代 2｜分析与决策协同', ['类型 / 人群 / 场景 · 痛点 / 方案假设 · U/M/S/C 依据', 'PM → PM Leader 复核；评级冲突提醒与时效统计'], kind='focal', title_size=16)
    s += box(420, 364, 440, 88, '迭代 3｜执行与验证闭环', ['规划 → 方案 → 研发 → 上线 → 验证；状态变化提醒', '记录上线指标与反馈人验收，未达预期时回到复评'], title_size=16)
    s += box(420, 480, 440, 80, '迭代 4｜VOC / NPS 信号接入', ['按授权接入并去重；关联未关闭需求，按已确认规则提示复评'], title_size=16)
    s += box(48, 256, 280, 76, '探索项：虚拟用户 / KANO', ['模拟结论标作假设；与真实调研分开', '不单独用于需求决策'], kind='optional', title_size=16, sub_size=12)
    s += path('M328,292 H420', slug, 'optional')
    s += text(48, 604, '决策边界：AI 提供可解释建议；PM / PM Leader 核实证据、确定最终评级和采纳结果。', 12, MUTED, 400, 'start')
    s.append(f'<line x1="48" y1="628" x2="1232" y2="628" stroke="{RULE}"/>')
    s += text(48, 656, '待确认：数据源授权、评分量表 / P0–P3 映射、执行状态与提醒时限。', 12, SOFT, 400, 'start')
    write(slug, s)


def roadmap_arch():
    slug = 'roadmap-architecture'
    s = start_svg(slug, 'Roadmap｜完整版本功能架构', '完整版本架构连接 Teambition、飞书表单和 VOC/NPS 来源；经过同步归一、需求记录、规则与 AI 分析、人工作业及执行验证，向工作台、通知和指标分析提供能力。', '业务能力视图，不预设具体云厂商、数据库或模型；数据授权、通知渠道和规则配置需分阶段确认')
    # Three zones, one aggregate input to avoid misleading fan-in.
    s.append('<rect class="zone" x="48" y="152" width="248" height="432" rx="8"/>')
    s.append('<rect class="zone" x="320" y="128" width="592" height="472" rx="8"/>')
    s.append('<rect class="zone" x="936" y="152" width="296" height="432" rx="8"/>')
    s.append(f'<rect x="64" y="156" width="124" height="18" rx="2" fill="{PAPER}"/>'+text(126,169,'INPUT SOURCES',9,MUTED,500,family=MONO))
    s.append(f'<rect x="336" y="132" width="144" height="18" rx="2" fill="{PAPER}"/>'+text(408,145,'PLATFORM CORE',9,MUTED,500,family=MONO))
    s.append(f'<rect x="952" y="156" width="144" height="18" rx="2" fill="{PAPER}"/>'+text(1024,169,'TEAM WORKFLOW',9,MUTED,500,family=MONO))
    # Connectors drawn first. Orthogonal routes avoid every non-endpoint box.
    s += path('M276,356 H308 Q316,356 316,348 V198 Q316,190 324,190 H344', slug, 'link')
    s += path('M454,232 V300', slug)
    s += path('M564,340 H616', slug, 'link')
    s += path('M564,320 H592 Q600,320 600,312 V198 Q600,190 608,190 H616', slug)
    s += path('M726,232 V300', slug, 'accent')
    s += path('M836,190 H880 Q888,190 888,198 V460 Q888,468 880,468 H836', slug)
    s += path('M836,340 H952', slug, 'async')
    s += path('M836,468 H876 Q884,468 884,460 V372 Q884,364 892,364 H952', slug, 'async')
    s += path('M726,504 V524 Q726,532 718,532 H462 Q454,532 454,540', slug)
    s += path('M564,576 H952', slug, 'link')
    s += path('M952,198 H916 Q908,198 908,206 V468 Q908,476 900,476 H836', slug, 'optional')
    # Nodes
    s += box(64, 296, 212, 120, '多来源需求信号', ['Teambition 项目同步', '飞书内部需求表单', '社媒 / 电商 VOC 与场景 NPS'], kind='external', title_size=15, sub_size=12)
    s += box(344, 164, 220, 68, '接入与归一', ['字段校验 · 去重 · 来源标注'], title_size=14)
    s += box(344, 300, 220, 80, '需求记录与审计', ['原文、附件引用、AI 与人工版本'], kind='store', title_size=14)
    s += box(616, 164, 220, 68, '规则与分配服务', ['必填校验 · 路由规则 · 评分公式'], title_size=14)
    s += box(616, 300, 220, 80, 'AI 语义分析', ['补全 / 分类 / 场景 / U-M-S-C 证据', '模型提供方待选'], kind='focal', title_size=14)
    s += box(616, 432, 220, 72, 'PM / PM Leader 决策', ['编辑 · 复核 · 最终采纳与评级'], title_size=14)
    s += box(344, 540, 220, 72, '执行与验证状态机', ['规划 / 方案 / 研发 / 上线 / 验证'], title_size=14)
    s += box(952, 164, 264, 68, '需求工作台', ['查看、筛选、分配与复核'], title_size=14)
    s += box(952, 300, 264, 80, '通知与提醒', ['待办 / 失败 / 超时 / 变更；渠道待确认'], title_size=14)
    s += box(952, 540, 264, 72, '指标与复评看板', ['时效、采纳差异、VOC / NPS 关联'], kind='store', title_size=14)
    s.append(f'<line x1="48" y1="644" x2="1232" y2="644" stroke="{RULE}"/>')
    s += text(48,672,'治理贯穿：真实来源与模型推断分开标识；AI 建议不覆盖人工决策；模拟用户结果独立标注为假设。',12,MUTED,400,'start')
    write(slug, s)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    mvp_flow()
    mvp_arch()
    sequence()
    roadmap_flow()
    roadmap_arch()
    for p in sorted(OUT.glob('*.svg')):
        print(p.name)
