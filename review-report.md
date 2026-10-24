# AI 代码评审报告

> 由 **ai-review** 生成 · 2026-09-24T11:21:02.745Z

## 总览

| 项目 | 数值 |
|---|---|
| 门禁结果 | ✖ 未通过（已拦截） |
| 评审文件数 | 7 |
| 降级文件数 | 0 |
| 问题总数 | 48 |
| 🔴 blocker | 2 |
| 🟡 warning | 29 |
| 🔵 info | 17 |

**评审摘要**：

共 7 个文件参与评审：
- 在 .gitignore 中新增忽略 AI 评审报告目录与报告文件。（.gitignore）
- 新增 db/pipeline.json，定义包含 4 个节点的流水线配置，节点含 id、department、step、ready、status 及可选 runner 字段。（db/pipeline.json）
- 新增 src/db.ts，提供基于 JSON 文件的用户/管线节点读写与认证逻辑。（src/db.ts）
- 将内联的 ensureReportServer 抽取到 serve.js 并新增 platform 子命令启动 AI 管线平台服务。（src/index.ts）
- 新增 AI 管线平台 HTTP 服务，包含登录会话、静态资源白名单、管线页渲染与节点执行/批准 API。（src/platform.ts）
- 新增 ensureReportServer：通过 .server 握手文件探测/后台拉起报告服务并返回 base URL。（src/serve.ts）
- 新增 ai-pipeline 平台增强脚本，注入顶栏用户信息/退出、节点状态展示、详情面板执行/批准动作及轮询刷新。（web/ai-pipeline-app.js）

## 问题明细

| 严重级别 | 位置 | 类别 | 问题 | 建议 |
|---|---|---|---|---|
| warning | `db/pipeline.json:3` | 可维护性 | 节点 id 使用字符串 "01"~"04" 且带前导零，与常见数字 id 语义不一致，排序/比较时易出现 "10" < "2" 之类的字典序问题，且前导零在部分解析场景下可能被误当作八进制。 | 建议将 id 改为无前导零的字符串（如 "1"）或数字类型，并统一约定 id 的类型与格式。 |
| warning | `db/pipeline.json:3` | 可维护性 | 各节点字段结构不一致：仅 id=03 的节点包含 runner 字段，其余节点缺失。若消费方按固定 schema 解析，缺失字段可能导致 undefined 或校验失败。 | 统一节点字段结构，为所有节点显式声明 runner（无则设为 null 或空字符串），或在文档/注释中明确 runner 为可选字段。 |
| info | `db/pipeline.json:3` | 可维护性 | status 全部为 "todo"、ready 多为 false，但未定义 status 与 ready 的取值枚举及二者关系（如 ready 是否由 status 派生），语义模糊。 | 在文件或配套文档中补充字段取值枚举与含义说明，明确 ready 与 status 的关系，避免消费方各自解读。 |
| blocker | `src/db.ts:47` | 安全 | authenticate 使用明文密码直接比较（user.password !== password），且 UserAccount.password 注释明确说明以明文存储于 users.json，属于敏感信息明文存储与比较，一旦 db/users.json 泄露即可直接登录。 | 改为存储加盐哈希（如 bcrypt/scrypt/argon2），authenticate 中使用恒定时间比较（如 crypto.timingSafeEqual）校验哈希，禁止在代码/数据中保留明文密码。 |
| warning | `src/db.ts:44` | 正确性 | loadUsers 直接 readFileSync + JSON.parse，若 db/users.json 不存在或内容非法会抛出异常（ENOENT/SyntaxError），调用方（authenticate）未捕获，可能导致进程崩溃或 500。 | 对文件不存在与解析失败做容错处理（try/catch 返回空数组或抛出带上下文的业务错误），并在 authenticate 中处理异常。 |
| warning | `src/db.ts:56` | 正确性 | loadNodes 同样未处理文件缺失/JSON 解析失败，且与 loadUsers 逻辑重复，异常会向上抛出。 | 抽取通用的 readJson 辅助函数统一处理读取与解析异常，返回默认值或抛出明确错误。 |
| warning | `src/db.ts:63` | 正确性 | saveNodes 使用 writeFileSync 直接覆盖写入，非原子操作；若写入过程中进程中断或并发调用，pipeline.json 可能被截断/损坏，导致后续 loadNodes 解析失败。 | 采用「写临时文件 + rename」的原子写入方式，并考虑对并发写加锁或串行化。 |
| warning | `src/db.ts:50` | 正确性 | authenticate 中 email.trim().toLowerCase() 做了归一化，但 loadUsers 返回的 u.email 未做同样归一化，若 users.json 中邮箱含大写或空格将永远匹配失败。 | 比较时对 u.email 也做 trim().toLowerCase()，或在加载时统一归一化。 |
| info | `src/db.ts:50` | 安全 | 密码比较未使用恒定时间算法，理论上存在时序侧信道（尽管明文比较下影响有限）。 | 改用哈希后配合 crypto.timingSafeEqual 进行恒定时间比较。 |
| info | `src/db.ts:5` | 可维护性 | DB_DIR 依赖 import.meta.url 向上取一级目录，注释假设 src 与 dist 均位于仓库根下一级；若构建产物目录层级变化（如 dist/src/），路径会指向错误位置。 | 改为通过环境变量或配置项注入数据目录，或在构建时保证目录层级稳定并补充说明。 |
| warning | `src/index.ts:263` | 正确性 | platform 子命令的端口回退循环与 serve 分支逻辑重复，且当 startPlatformServer 抛出非 EADDRINUSE 错误时直接 throw，未捕获处理；同时循环结束后若 srv 未赋值仅打印错误，但若 startPlatformServer 内部已部分初始化资源可能泄漏。 | 抽取端口回退逻辑为公共函数，并在 catch 中确保非 EADDRINUSE 错误时清理已分配资源或记录日志后退出。 |
| info | `src/index.ts:281` | 安全 | 帮助文本中明文提示演示密码统一为 123456，且登录页提示同样暴露该信息，存在弱口令风险。 | 移除帮助文本和启动日志中的明文密码提示，改为引导用户查看文档或环境变量配置。 |
| info | `src/index.ts:264` | 可维护性 | args.repo 使用 resolve(args.repo) 但未校验路径是否存在或是否为目录，若传入非法路径会在后续节点执行时失败。 | 在启动前校验 repo 路径存在且为目录，否则给出明确错误提示。 |
| warning | `src/platform.ts:96` | 正确性 | readBody 在超过 maxBytes 时 reject 并 destroy 请求，但 'end' 事件仍可能触发 resolve，导致 Promise 已 reject 后再次 resolve（虽被忽略），且 req.destroy() 后 'error' 事件可能再次 reject。更重要的是：调用方 /api/login 用 try/catch 包裹，但其他潜在调用方若未处理会挂起。 | 在 reject 后设置一个标志位（如 settled），在 'end'/'error' 回调中检查该标志，避免重复 settle；或统一使用 once 语义。 |
| info | `src/platform.ts:113` | 可维护性 | STATIC_FILES 白名单仅 3 个文件，但 serveStatic 用 readFileSync 同步读取，阻塞事件循环。对静态资源可接受，但若后续扩展需注意。 | 可考虑缓存文件内容或改用异步读取，当前规模可保留。 |
| warning | `src/platform.ts:128` | 正确性 | pipelineHtml 用 raw.replace("</body>", ...) 注入脚本。若 ai-pipeline.html 中不存在 </body>（如大小写不同或缺失），replace 静默失败，注入的 bootstrap 与脚本不会生效，页面功能异常且无报错。 | 检查 replace 结果是否变化，未变化时抛出明确错误或记录日志。 |
| warning | `src/platform.ts:140` | 正确性 | updateNode 采用 loadNodes → mutate → saveNodes 的读改写模式，但 runAiReviewNode 是异步后台任务，期间其他请求（如 approve、其他节点 execute）也会 loadNodes/saveNodes，存在并发覆盖（lost update）风险，可能丢失其他节点的状态变更。 | 引入串行化机制（如内存锁/队列）或基于文件锁的原子更新，确保读改写不交错。 |
| warning | `src/platform.ts:152` | 正确性 | runAiReviewNode 中 writeReviewReport 写入 join(repo, "review-report.md")，随后 mkdirSync/writeFileSync 写 REPORTS_DIR。若 repo 路径来自 opts.repo（用户可控），存在向任意路径写入文件的风险（路径穿越/任意文件写入）。 | 校验 repo 为合法目录且限制在预期根目录内；或明确文档说明 repo 仅由可信调用方传入。 |
| info | `src/platform.ts:196` | 可维护性 | 启动时清理 running 状态逻辑正确，但 lastResult 文案硬编码中文，且未区分不同 runner 类型。 | 可提取常量或 i18n，当前可接受。 |
| warning | `src/platform.ts:213` | 安全 | new URL(req.url ?? "/", `http://${host}`) 中 host 来自 opts.host（默认 127.0.0.1）。若 host 被配置为包含特殊字符或用户可控，可能影响 URL 解析。此外未校验 req.url 中的路径编码，path 可能包含 %2e%2e 等编码后的穿越序列。 | 对 path 做 decodeURIComponent 后再校验，或使用固定 base URL 解析。 |
| warning | `src/platform.ts:232` | 安全 | 登录接口未做速率限制/防暴力破解，且错误信息统一为"邮箱或密码错误"（良好）。但 authenticate 若内部使用非恒定时间比较密码，存在时序攻击风险（需看 db.ts 实现）。 | 增加登录失败次数限制/延迟；确认 authenticate 使用恒定时间比较。 |
| info | `src/platform.ts:255` | 正确性 | logout 调用 destroySession(parseCookies(req.headers.cookie)[SESSION_COOKIE])，若 cookie 不存在则传入 undefined，需确认 destroySession 能安全处理 undefined。 | 确认 destroySession 对 undefined 的容错，或在此处做空值判断。 |
| warning | `src/platform.ts:300` | 正确性 | execute 分支中 node.status === "running" 检查后设置 running 并 saveNodes，但未检查 node.status === "done" 的情况——已完成的节点可被重复执行（覆盖结果）。虽然可能是有意设计，但缺少明确语义。 | 明确是否允许重复执行 done 节点，若不允许则增加状态检查。 |
| blocker | `src/platform.ts:313` | 正确性 | runAiReviewNode(repo) 使用闭包捕获的 repo（来自 opts.repo ?? process.cwd()），而非节点关联的仓库。所有 ai-review 节点都评审同一个 repo，若存在多个不同仓库的节点会评审错误目标。 | 从 node 上读取目标仓库路径（如 node.repo），或明确该平台仅支持单一 repo 并在文档中说明。 |
| warning | `src/platform.ts:326` | 正确性 | 后台任务 .then/.catch 中调用 updateNode(node.id, ...)，但 node.id 来自闭包中的 node 对象。若期间节点被删除或 id 变化，updateNode 会静默 return。此外 catch 中 err?.message 直接写入 lastResult 并最终渲染到页面，若 err.message 含用户可控内容（如 repo 路径），存在 XSS 风险（取决于前端渲染方式）。 | 对 lastResult 中的错误信息做转义或截断；前端渲染时确保使用 textContent 而非 innerHTML。 |
| warning | `src/platform.ts:341` | 正确性 | approve 分支检查了 approved 和 running，但未检查 node.ready。若节点能力未接入（ready=false），主管仍可批准，语义上可能不合理。 | 确认 approve 是否应要求 node.ready，若需要则增加检查。 |
| warning | `src/platform.ts:357` | 正确性 | execute 分支中 node.status = "done" 后 saveNodes(nodes) 与 sendJson 在 357-359 行执行，但 ai-review 分支在 313-340 行已提前 return。非 ai-review 节点直接标记 done 而不执行任何实际逻辑，可能不符合预期（所有非 ai-review 节点执行都只是改状态）。 | 确认非 ai-review 节点的执行语义，或对未接入 runner 的节点返回明确提示。 |
| info | `src/platform.ts:371` | 可维护性 | server.listen 使用 opts.port ?? 0（随机端口），但 DEFAULT_PLATFORM_PORT 常量（4311）未被使用，存在死代码/误导。 | 使用 DEFAULT_PLATFORM_PORT 作为默认值，或移除未使用的常量。 |
| info | `src/platform.ts:381` | 正确性 | close() 仅调用 server.close()，未处理已存在的连接（keep-alive）可能导致 close 回调长时间不触发。 | 可考虑 server.closeAllConnections() 或设置超时。 |
| warning | `src/serve.ts:322` | 正确性 | fallbackPort 直接来自 process.env.AI_REVIEW_PORT，未做数字校验；若环境变量为非数字（如 'abc'）则 Number 得到 NaN，spawn 参数会变成 '--port NaN'，且最终返回 'http://127.0.0.1:NaN' 的非法 URL。 | 对解析结果做校验：const parsed = Number(process.env.AI_REVIEW_PORT); const fallbackPort = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_REPORT_PORT; |
| warning | `src/serve.ts:326` | 正确性 | 读取 .server 文件后直接使用 m.url 拼接 /health 请求，未校验 m.url 是否为字符串/合法 URL；若文件被外部篡改或写入非法内容，fetch 可能抛异常（虽被 catch 吞掉）或请求到非预期地址。 | 在使用前校验 typeof m.url === 'string' 且以 http://127.0.0.1: 或 http://localhost: 开头，否则视为失效重新拉起。 |
| warning | `src/serve.ts:344` | 正确性 | 轮询等待共 40*150ms=6s，超时后直接返回 fallbackPort 构造的 URL，但此时服务可能并未真正启动（端口被占用、子进程崩溃等），调用方拿到的是不可用地址，且无任何错误提示，属于静默失败。 | 超时后应抛出明确错误或返回可区分的失败标识，让调用方感知服务未就绪，而不是返回一个可能不可用的 URL。 |
| warning | `src/serve.ts:341` | 正确性 | spawn 未监听 'error' 事件，若 CLI_ENTRY 不存在或 process.execPath 启动失败，错误会被吞掉（detached+stdio ignore），随后进入 6s 轮询并最终返回不可用 URL，问题难以排查。 | 为 spawn 返回的 child 绑定 child.on('error', ...) 记录日志，或在拉起前用 existsSync(CLI_ENTRY) 做前置校验。 |
| info | `src/serve.ts:312` | 可维护性 | CLI_ENTRY 通过 here.endsWith('.ts') 判断源文件/构建产物，逻辑隐晦且依赖文件扩展名约定；若未来引入 .mts/.cts 或打包为单文件会失效。 | 改为显式判断（如基于 import.meta.url 的目录名或构建时注入常量），并补充注释说明该约定的前提。 |
| info | `src/serve.ts:326` | 可维护性 | 探测已有服务与轮询等待新服务两段代码几乎完全重复（读 .server、校验 m.dir、fetch /health、判断 ok），后续修改易遗漏一处。 | 抽取一个 tryReadServerUrl(serverFile, dir): Promise<string \| null> 辅助函数，两处复用。 |
| info | `src/serve.ts:344` | 可维护性 | 轮询次数 40 与间隔 150ms 为魔法数字，含义（约 6 秒超时）不直观。 | 提取为具名常量，如 const SERVER_WAIT_RETRIES = 40; const SERVER_WAIT_INTERVAL_MS = 150; |
| info | `src/serve.ts:356` | 可维护性 | 文件末尾缺少换行符（\ No newline at end of file），不符合常规代码风格。 | 在文件末尾补一个换行符。 |
| warning | `web/ai-pipeline-app.js:60` | 正确性 | post() 中 r.json() 未处理非 JSON 响应（如 500 HTML 错误页或 204 空响应），会导致 JSON 解析异常，被外层 catch 捕获后统一提示“网络异常”，掩盖真实错误。 | 在解析前判断 content-type 或捕获 json 解析失败，返回 {ok:r.ok, data:null}，并区分网络错误与业务错误。 |
| warning | `web/ai-pipeline-app.js:68` | 正确性 | renderTopbar 中直接使用 user.title 和 ROLE_TEXT[user.role]，若 boot.user 缺失或 role 不在映射表中，会显示 undefined 或抛错。 | 对 user 做存在性校验，ROLE_TEXT[user.role] 提供兜底值（如 user.role \|\| '未知角色'）。 |
| warning | `web/ai-pipeline-app.js:88` | 正确性 | renderNodeStatus 中 STATUS_TEXT[node.status] 未做兜底，若后端返回未知状态会显示 undefined。 | 使用 STATUS_TEXT[node.status] \|\| node.status 或提供默认文案。 |
| info | `web/ai-pipeline-app.js:118` | 可维护性 | 通过 indexOf('失败')/indexOf('未通过') 判断结果状态属于字符串魔法值匹配，脆弱且依赖中文文案。 | 建议后端返回结构化字段（如 lastResultStatus），前端据此判断样式。 |
| warning | `web/ai-pipeline-app.js:130` | 安全 | link.href 直接使用后端返回的 node.reportUrl，未校验协议，若被注入 javascript: 伪协议可导致 XSS。 | 校验 reportUrl 以 http(s):// 或 / 开头，否则不渲染链接。 |
| warning | `web/ai-pipeline-app.js:139` | 正确性 | addBtn 点击后立即禁用按钮，但若 post 返回成功且状态仍为 done（非 running），按钮不会恢复，且 renderActions 重建时旧按钮被移除，逻辑上依赖重建；若 res.data.node 缺失但 res.ok 为真，会进入 else 分支恢复按钮，行为不一致。 | 明确成功/失败分支，成功时统一走重建流程，失败时恢复按钮状态。 |
| warning | `web/ai-pipeline-app.js:139` | 正确性 | post 请求未携带 CSRF token 或认证头，若后端依赖 cookie 之外的防护，执行/批准动作可能被 CSRF 攻击。 | 确认后端有 CSRF 防护；如有需要，在请求头中附带 CSRF token。 |
| warning | `web/ai-pipeline-app.js:196` | 正确性 | startPolling 中 fetch('/api/nodes') 未处理非 401 的错误状态码（如 500），r.json() 可能抛错被 catch 静默吞掉，导致轮询持续但永不更新。 | 对非 2xx 响应做处理，必要时停止轮询或提示用户。 |
| info | `web/ai-pipeline-app.js:196` | 可维护性 | 轮询间隔 2000 为魔法数字，且未设置最大轮询次数/超时，长时间运行节点会无限轮询。 | 提取为常量，并考虑增加最大轮询时长或次数上限。 |
| warning | `web/ai-pipeline-app.js:221` | 正确性 | pipeline-show 事件中 Number(e.detail) 若 detail 非数字会得到 NaN，renderActions(NaN) 中 nodes[NaN] 为 undefined 直接 return，但 detailIdx 被设为 NaN，后续轮询 renderActions(detailIdx) 同样无效。 | 校验 Number.isInteger(idx) 后再赋值。 |
| info | `web/ai-pipeline-app.js:228` | 可维护性 | 使用 Array.prototype.findIndex 在旧浏览器（如 IE）不支持，脚本未做 polyfill 或兼容处理。 | 若需兼容旧环境，改用循环查找或引入 polyfill。 |
