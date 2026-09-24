# 评审页面左右分栏 + GitHub 风格 Diff 视图

## Context（为什么改）

当前评审报告页是**单列布局**：评审结论 → 摘要 → 统计 → 问题明细纵向堆叠。问题行号只有**单行**（`ReviewIssue.line: number`），AI prompt 也只要求输出单行号。用户希望：

1. **左右分栏**：左侧保留问题明细，右侧新增 GitHub 风格 diff 视图（绿色新增 / 红色删除 / 灰色上下文行 + 行号）。
2. **AI 输出规范为行号范围**：问题明细要详细到「第 X 行到第 Y 行」，能与右侧 diff 行号对应。
3. **联动交互**：点击左侧某条问题，右侧 diff 自动滚动到对应代码行并高亮闪烁。

关键差距：`DiffFile[]`（含 diff 原文）目前只在 [index.ts](file:///d:/code/ai-flows/src/index.ts#L55) 的 `run()` 里被消费，**没有传进 `ReportView`**，渲染层拿不到 diff；`ReviewIssue.line` 是单行号。

## 改造点

### 1. 数据模型 — [gate.ts](file:///d:/code/ai-flows/src/gate.ts#L5)

`ReviewIssue` 增加行号范围字段（向后兼容）：

```ts
export interface ReviewIssue {
  file: string;
  /** 问题起始行号（约数即可） */
  line: number;
  /** 问题结束行号（缺省 = line，即单行问题） */
  lineEnd?: number;
  severity: Severity;
  category: string;
  message: string;
  suggestion?: string;
}
```

保留 `line` 作为起始行号（不破坏旧字段语义），新增可选 `lineEnd`。

### 2. 评审层 — [reviewer.ts](file:///d:/code/ai-flows/src/reviewer.ts)

**a. `buildPrompt`（L12）**：prompt 里 JSON 结构示例从 `"line": <行号>` 改成要求输出 `lineStart` 和 `lineEnd`，并加一句「问题若跨多行，lineStart/lineEnd 表示起止行号；单行问题二者相等」。

**b. `normalizeIssues`（L106）**：解析时同时认 `lineStart`/`lineEnd` 和旧 `line` 字段：
```ts
const lineStart = Number(raw.lineStart ?? raw.line) || 0;
const lineEnd = Number(raw.lineEnd ?? raw.lineStart ?? raw.line) || lineStart;
return { ..., line: lineStart, lineEnd: lineEnd === lineStart ? undefined : lineEnd };
```

**c. `ReportIssueView`（L219）**：保留 `loc`（拼好的 `file:line` 或 `file:line-lineEnd`），新增联动用原始字段：
```ts
export interface ReportIssueView {
  severity: Severity;
  loc: string;
  file: string;        // 新增：联动用
  lineStart: number;   // 新增
  lineEnd: number;     // 新增
  category: string;
  message: string;
  suggestion?: string;
}
```

**d. `ReportView`（L229）**：新增 `diffFiles` 字段携带 diff 视图数据：
```ts
export interface ReportView {
  // ...既有字段...
  diffFiles: DiffFileView[];   // 新增
}

/** diff 视图按行拆分的结构，供 reporter 直接渲染 */
export interface DiffFileView {
  path: string;
  hunks: DiffHunkView[];
}
export interface DiffHunkView {
  oldStart: number; oldEnd: number; newStart: number; newEnd: number;
  lines: DiffLineView[];
}
export interface DiffLineView {
  type: "add" | "del" | "ctx";
  /** 新增/上下文行的新文件行号；删除行为 undefined */
  newNo?: number;
  /** 删除/上下文行的旧文件行号；新增行为 undefined */
  oldNo?: number;
  text: string;
}
```

**e. `parseDiff(text: string): DiffHunkView[]`**：新增纯函数，解析 git unified diff。按 `@@ -a,b +c,d @@` 分 hunk，逐行推送：
- ` ` 上下文行（同时有 oldNo + newNo）
- `+` 新增行（只有 newNo）
- `-` 删除行（只有 oldNo）
- `\` No newline 行跳过
- 纯函数，需补 `reviewer.test.ts` 测试

**f. `formatReport`（L259）**：签名加 `files: DiffFile[]` 参数，解析成 `DiffFileView[]` 塞进 view；issue 的 `file`/`lineStart`/`lineEnd` 同步填好。

### 3. 报告层 — [reporter.ts](file:///d:/code/ai-flows/src/reporter.ts)

**a. `buildReportView`（L365）**：签名加 `files: DiffFile[]`：
```ts
export function buildReportView(
  result: ReviewResult,
  files: DiffFile[],
  gate: GateSummary,
  pushes?: PushResult[],
  meta?: { repo?: string; ref?: string }
): ReportView
```
内部转发给 `formatReport(result, files, gate, meta)`。

**b. `REPORT_CSS`（L118）**：新增样式
- `.split` 容器：`display:grid; grid-template-columns: 4fr 6fr; gap:20px;` （diff 更宽易读），`@media(max-width:980px){ grid-template-columns:1fr }` 堆叠
- `.diff-panel`：右侧滚动容器 `position:sticky; top:20px; max-height:calc(100vh-40px); overflow:auto;`
- `.diff-file`：每文件一个块，带文件名标题栏
- `.diff-line`：等宽字体，`display:flex`，左行号槽 `.diff-gutter`（固定宽，灰字）+ 右代码内容
- `.diff-line.add`：绿色背景 `background:rgba(122,220,192,.10)`，左边框绿色
- `.diff-line.del`：红色背景 `background:rgba(240,85,69,.10)`，左边框红色
- `.diff-line.ctx`：默认灰
- `.diff-line.target`：高亮闪烁动画（`@keyframes flash` 黄色脉冲 2 次）

**c. `issueList()`（L251）**：每个 `<article>` 加 `data-file` + `data-line-start` + `data-line-end` + `tabindex=0` + `cursor:pointer`，loc 显示 `file:line` 或 `file:line-lineEnd`。

**d. 新增 `diffPanel(v): string`**：渲染右侧。遍历 `v.diffFiles`，每个文件一个 `.diff-file`（标题显示 path + 行数统计），内部 hunks 逐行渲染：
```html
<div class="diff-line <type>" data-file="<path>" data-line="<newNo>">
  <span class="diff-gutter"><oldNo></span>
  <span class="diff-gutter"><newNo></span>
  <code class="diff-content"><text></code>
</div>
```
- 仅 `add`/`ctx` 行带 `data-line`（用 newNo，对应 AI 报告的行号）；`del` 行不参与联动定位
- 插值全部走 `esc()`，diff 内容不可信

**e. `renderTemplate`（L294）**：body 结构调整 — 顶栏/verdict/summary/stats/pushes 保留全宽在顶部，下方加：
```html
<div class="split">
  <section class="split-left">
    <div class="section-head"><h2>问题明细</h2><span class="count">...</span></div>
    ${issueList(v)}
  </section>
  <section class="split-right diff-panel">
    <div class="section-head"><h2>代码变更</h2><span class="count">N 个文件</span></div>
    ${diffPanel(v)}
  </section>
</div>
```

**f. 新增 `<script>`**（`renderTemplate` 末尾 `</body>` 前）：纯原生 JS 实现点击联动。点击 `.issue[data-file]` → 读 `lineStart/lineEnd` → 在 `.diff-line[data-file]` 里找 `newNo` 落在范围内的第一行 → `scrollIntoView({behavior:'smooth',block:'center'})` + 加 `.target` 类（定时 1.5s 后移除）。文件名匹配用 JS 遍历比较 `dataset.file`，不用 CSS attribute selector（避免特殊字符转义问题）。

### 4. 入口 — [index.ts](file:///d:/code/ai-flows/src/index.ts#L106)

`run()` 里调用 `buildReportView` 时把 `files` 传进去：
```ts
const view = buildReportView(result, files, gate, pushes, { ref });
```

### 5. 测试 — 新增 [reviewer.test.ts](file:///d:/code/ai-flows/src/reviewer.test.ts)

按 AGENTS.md 要求，改动 `reviewer.ts` 纯函数必须补测试。覆盖：
- `parseDiff`：标准 hunk 头 + add/del/ctx 行 + No newline 行 + 空输入
- `extractJson`（既有要求，本次一并补）：带围栏 / 带前后缀 / 非法 JSON 抛错

运行：`npx tsx --test "src/**/*.test.ts"`

## 不改动的范围

- `serve.ts`：路由不变，`renderTemplate(view)` 入参仍是 `ReportView`，只是字段变多
- `collector.ts`：`DiffFile` 形状不变（已有 `diff` 原文，直接用）
- `config.ts`：不动
- 退出码契约 / 渲染契约（ReportView 作为渲染唯一输入）/ HTML 转义规则均保持

## 验证

1. **类型检查（唯一自动化门禁）**：`npx tsc --noEmit` 必须通过
2. **单元测试**：`npx tsx --test "src/**/*.test.ts"`
3. **端到端手工验证**（需 `ai-review.config.json` + `DEEPSEEK_API_KEY`）：
   ```
   npx tsx src/index.ts run --no-push --page
   ```
   打开打印的链接，检查：
   - 左右分栏（宽屏并排，窄屏堆叠）
   - 右侧 diff：绿色新增 / 红色删除 / 灰色上下文 + 行号
   - 左侧问题显示 `file:lineStart-lineEnd`
   - 点击左侧问题 → 右侧滚动到对应行 + 高亮闪烁
   - AI 返回的行号范围与右侧 diff 行号能对应上

## 同步项

- `AGENTS.md` §渲染契约示例代码 `buildReportView(result, gate, pushes, { ref })` 签名变化，需同步更新为 `buildReportView(result, files, gate, pushes, { ref })`（AGENTS.md 与其镜像文件若存在需同步）
