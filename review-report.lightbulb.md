# AI 代码评审报告

> 由 **ai-review** 生成 · 2026-09-23T09:00:56.843Z

## 总览

| 项目 | 数值 |
|---|---|
| 门禁结果 | ✖ 未通过（已拦截） |
| 评审文件数 | 12 |
| 降级文件数 | 0 |
| 问题总数 | 84 |
| 🔴 blocker | 2 |
| 🟡 warning | 56 |
| 🔵 info | 26 |

**评审摘要**：新增 character-test 技能文档，定义 AI 角色对话测试智能体的完整 SOP、API 索引与故障排查。 在 app.ts 中新增 characterChat 路由的导入与挂载，注册 /api/character-chat 端点。 新增 AI 角色对话相关的数据库表（characters、character_conversations、character_messages、character_test_runs）及对应的 CRUD 操作函数。 新增角色聊天路由，包含角色/对话 CRUD、SSE 流式聊天、角色测试与预设初始化接口。 新增角色提示词服务，包含情绪检测、系统提示词构建和情绪标签解析功能。 在 App.tsx 中新增 CharacterChatPage 导入，并为 'character-chat' 路由分支添加对应页面渲染。 在 Header 的 TABS 数组中新增一个 'character-chat' 标签页项。 新增 useCharacterChat hook，封装角色聊天的人物/会话加载、消息流式发送与状态管理。 新增角色聊天页面组件，包含角色/对话列表、消息气泡、模型选择与测试面板。 为图片 aspectRatio 样式增加对 ':' 分隔尺寸格式的支持，同时保留原有 'x' 格式的解析逻辑。 新增 characterChatApi 服务模块，封装角色聊天相关的角色、会话、SSE 消息发送及测试接口。 在 FeatureType 中新增 'character-chat' 类型，并新增角色聊天相关的类型定义（GameCharacter、CharacterConversation、CharacterChatMessage）及情绪配置常量 EMOTION_CONFIG。

## 问题明细

| 严重级别 | 位置 | 类别 | 问题 | 建议 |
|---|---|---|---|---|
| warning | `.codebuddy/skills/character-test/SKILL.md:88` | 安全 | 文档指导通过 curl 从 /api/model-configs 拉取包含 apiKey 的完整模型配置，并直接拼入后续请求体。这会把明文密钥暴露在命令行历史、进程列表和日志中，且暗示后端接口会明文返回 apiKey。 | 改为让后端测试接口自行按 configId 读取密钥，前端/CLI 只传配置 id；若必须传，明确提示不要记录到日志，并确认 /api/model-configs 对 apiKey 做脱敏。 |
| warning | `.codebuddy/skills/character-test/SKILL.md:95` | 安全 | 示例中 `-d '{"config": {获取的模型配置}}'` 是占位符，但结合上文 node 脚本会输出含 apiKey 的 JSON，实际执行时会把密钥写入 shell 历史与可能的调试日志。 | 改为传 configId 或使用环境变量/临时文件并设置权限，避免密钥出现在命令行参数中。 |
| warning | `.codebuddy/skills/character-test/SKILL.md:44` | 正确性 | Step 0 使用 `curl -s http://localhost:3001/health` 判断后端是否运行，但未检查 HTTP 状态码或响应内容，curl 在连接失败时仍可能返回 0 退出码（-s 静默），导致误判后端可用。 | 改为 `curl -sf` 或显式检查响应体/状态码，例如 `curl -s -o /dev/null -w '%{http_code}'`。 |
| warning | `.codebuddy/skills/character-test/SKILL.md:57` | 正确性 | Step 1 声称调用 /character-chat/init-presets 会生成角色人格，但同段又说明 4 模块内容已硬编码在 presetDefinitions 中，接口只是初始化预设。描述与实际行为不一致，可能误导使用者以为会动态生成人格。 | 修正描述，明确 init-presets 仅初始化硬编码预设，人格生成实际由 persona-generation 完成或已内置。 |
| warning | `.codebuddy/skills/character-test/SKILL.md:120` | 正确性 | 总测试量计算为 4 角色 × (4 标准 + 8 固定追问 + 自拓展 1-3 轮) ≈ 50-60 条，但 4×(4+8)=48，加上自拓展 4×1~3=4~12，应为 52~60 条，与后文汇总表 52/52 及 Step 6 的 48/52 通过率数字不一致。 | 统一各处测试条数口径，明确自拓展轮数范围并修正汇总示例中的分母。 |
| warning | `.codebuddy/skills/character-test/SKILL.md:252` | 正确性 | 情绪标签列表前后不一致：身份定义（第 20 行附近）列出 12 种情绪（含中性），Step 4 来源 2 列出 14 种（多出厌恶、轻蔑），而 Step 4 来源 1 示例又用「开心」。多处枚举不一致易导致实现与文档脱节。 | 以代码中 EMOTION_CONFIG 为准，统一文档中所有情绪枚举列表。 |
| info | `.codebuddy/skills/character-test/SKILL.md:300` | 可维护性 | 汇总报告与详细日志中的分数、通过率、对话 ID 等均为硬编码示例值，容易被误读为真实输出格式约定。 | 在示例块前标注「示例数据，非真实结果」，或使用占位符如 <score>。 |
| info | `.codebuddy/skills/character-test/SKILL.md:340` | 可维护性 | 故障排查表提到数据库文件 `data/lightbulb.db`，但未说明其相对路径基准（项目根还是 backend 目录），排查时易定位错误。 | 补充完整相对路径，例如 `backend/data/lightbulb.db`，或注明相对于项目根目录。 |
| info | `.codebuddy/skills/character-test/SKILL.md:44` | 可维护性 | 文档中多处硬编码 `http://localhost:3001`，若后端端口可配置则文档会失效。 | 注明端口可通过环境变量配置，或统一引用一个 BASE_URL 占位符。 |
| warning | `backend/src/database.ts:200` | 正确性 | SQLite 默认不启用外键约束（PRAGMA foreign_keys 默认 OFF），此处声明的 ON DELETE CASCADE 不会生效，删除 character 时不会级联删除 conversations/messages/test_runs，会留下孤儿数据。 | 在 initDatabase 中执行 `database.run('PRAGMA foreign_keys = ON')`，或显式在 deleteCharacter 中手动级联删除相关记录。 |
| warning | `backend/src/database.ts:660` | 正确性 | getCharacterById 中若 stmt.step() 抛异常或提前 return 之外的分支，stmt.free() 可能不被调用；虽然当前逻辑覆盖了正常路径，但缺少 try/finally 保护，异常时会造成 statement 资源泄露。 | 使用 try { ... } finally { stmt.free(); } 包裹，确保任何路径下都释放 statement。 |
| warning | `backend/src/database.ts:682` | 正确性 | getCharacterConversationById 同样存在 stmt 未用 try/finally 保护的问题，异常时可能泄露 statement。 | 使用 try/finally 确保 stmt.free() 被调用。 |
| warning | `backend/src/database.ts:700` | 正确性 | createCharacter 中 `data.is_preset \|\| 0` 会把合法的 0 也当作 falsy 处理（虽然结果相同），但更严重的是若传入 is_preset 为 0 之外的其他 falsy 值语义不清；此外 `data.avatar_color \|\| '#6c5ce7'` 与表默认值重复。 | 使用 `data.is_preset ?? 0` 和 `data.avatar_color ?? '#6c5ce7'` 以区分 undefined 与 0/空字符串。 |
| warning | `backend/src/database.ts:720` | 正确性 | updateCharacter 使用动态拼接字段名，虽然 allowedFields 白名单限制了字段，但 values 中若传入 undefined 会被过滤（因为判断 !== undefined），逻辑正确；然而 `data.subtitle` 等字段若传入 null 会被写入，需确认调用方语义。整体白名单机制尚可，但缺少对 id 存在性的校验，更新不存在的 id 会静默成功。 | 可考虑在更新后检查 changes 数量，或在文档中明确静默失败的行为。 |
| warning | `backend/src/database.ts:745` | 正确性 | createCharacterMessage 中 `data.emotion_intensity \|\| null` 会把合法的 0 值（如情绪强度为 0）转换为 null，造成数据丢失。 | 使用 `data.emotion_intensity ?? null` 保留 0 值。 |
| warning | `backend/src/database.ts:745` | 正确性 | createCharacterMessage 中 `data.token_usage \|\| 0` 对 0 无影响，但若 token_usage 为 0 与 undefined 语义相同，问题不大；不过 message_count 的递增与插入不在同一事务中，若插入成功但更新失败会导致计数不一致。 | 将 INSERT 与 UPDATE message_count 放入同一事务（database.run('BEGIN')/COMMIT）以保证原子性。 |
| info | `backend/src/database.ts:760` | 可维护性 | 多处重复的 `results[0].values.map(row => { const obj: any = {}; columns.forEach(...) })` 行转对象逻辑，可抽取为公共辅助函数以减少重复。 | 提取一个 `rowsToObjects(results)` 工具函数供所有查询复用。 |
| info | `backend/src/database.ts:640` | 可维护性 | getAllCharacters 使用 `SELECT *`，若表结构变更（如新增列）会隐式影响返回对象，且与 CharacterRow 接口可能不同步。 | 显式列出所需列，或在类型层面做运行时校验。 |
| info | `backend/src/database.ts:200` | 可维护性 | characters 表缺少 name 唯一约束或索引，若业务上角色名需唯一则无法保证；同时 character_messages 表缺少 (conversation_id, created_at) 复合索引，按会话按时间排序查询在数据量大时可能变慢。 | 根据业务需求为 characters.name 添加唯一约束，并为 character_messages(conversation_id, created_at) 建立复合索引。 |
| info | `backend/src/database.ts:200` | 安全 | characters 表包含 system_prompt、behavior_rules 等敏感提示词字段，若接口层未做权限控制，可能被越权读取。本次 diff 仅涉及数据库层，需确认上层 API 有鉴权。 | 确认调用这些查询的 API 路由已做鉴权与角色隔离。 |
| blocker | `backend/src/routes/characterChat.ts:155` | 正确性 | POST /characters 创建后直接调用 formatCharacter(character)，但 createCharacter 返回的 id 若查询失败（getCharacterById 返回 undefined）会导致 formatCharacter 访问 undefined 属性抛错，且返回 500 而非明确错误。 | 在 formatCharacter 前判断 character 是否存在，若不存在返回 500 或 404 并给出明确错误信息。 |
| warning | `backend/src/routes/characterChat.ts:175` | 正确性 | PUT /characters/:id 未校验 id 是否为有效数字，Number(req.params.id) 可能为 NaN，updateCharacter 可能静默失败或更新错误记录；且更新后未检查角色是否存在。 | 校验 id 为有效正整数，更新后判断 getCharacterById 结果，不存在时返回 404。 |
| warning | `backend/src/routes/characterChat.ts:190` | 正确性 | DELETE /characters/:id 未校验 id 有效性，也未检查删除是否命中记录，删除不存在的 id 仍返回 success:true。 | 校验 id 并检查删除影响行数，未命中时返回 404。 |
| warning | `backend/src/routes/characterChat.ts:200` | 正确性 | GET /conversations 使用 Number(req.query.characterId)，当 characterId 为非数字字符串时得到 NaN，!characterId 判断对 NaN 为 true 会返回 400，但若传入 '0' 等边界值语义不清。 | 显式校验 Number.isInteger 且 > 0。 |
| warning | `backend/src/routes/characterChat.ts:213` | 正确性 | POST /conversations 未校验 characterId 是否为有效数字，getCharacterById(NaN) 行为不确定。 | 校验 characterId 为有效正整数后再查询。 |
| warning | `backend/src/routes/characterChat.ts:240` | 正确性 | GET /conversations/:id 未校验 id 有效性，Number(req.params.id) 可能为 NaN。 | 校验 id 为有效正整数。 |
| warning | `backend/src/routes/characterChat.ts:253` | 正确性 | DELETE /conversations/:id 未校验 id 有效性，删除不存在的对话仍返回 success:true。 | 校验 id 并检查删除结果。 |
| blocker | `backend/src/routes/characterChat.ts:268` | 安全 | SSE 接口在写入响应头前先执行了数据库写入（createCharacterMessage）和多次 await，若这些操作耗时较长，客户端可能超时；更重要的是，若后续 chatCompletionStream 抛错，用户消息已落库但无助手回复，造成数据不一致。 | 考虑先建立 SSE 连接或使用事务/补偿机制，确保用户消息与助手消息的一致性。 |
| warning | `backend/src/routes/characterChat.ts:300` | 正确性 | SSE 流式响应中，若 chatCompletionStream 正常结束但 createCharacterMessage 保存助手消息失败，会进入外层 catch，此时 headersSent 为 true，仅写入 error 事件，但用户消息已保存，导致对话历史不一致。 | 对保存助手消息的失败做单独处理，或记录日志并保证前端能感知。 |
| warning | `backend/src/routes/characterChat.ts:320` | 正确性 | detectEmotion 失败时静默降级为 '中性'，但 catch 块未记录任何日志，问题难以排查。 | 在 catch 中记录错误日志。 |
| warning | `backend/src/routes/characterChat.ts:360` | 可维护性 | POST /test/run 中预设角色定义（presetDefinitions）与 /init-presets 中的定义大量重复，且两处内容不完全一致（如 behavior_rules 缺少 '你是谁' 规则），维护时容易遗漏。 | 将预设角色定义抽取为共享常量模块，两处复用。 |
| warning | `backend/src/routes/characterChat.ts:420` | 正确性 | 测试循环中对每个问题都重新查询全部消息并 slice(-50)，随着对话增长每次查询全量消息，性能随消息数线性下降，且 50 条硬编码为魔法数字。 | 提取常量，并考虑按需分页查询最近 N 条消息。 |
| warning | `backend/src/routes/characterChat.ts:470` | 正确性 | 测试通过判定 `cleanContent.length > 0 && cleanContent.length < 200` 过于简单，200 为魔法数字，且无法真正评估角色质量，与后续 AI 分析报告逻辑重复。 | 提取常量并明确评估标准，或直接依赖 AI 分析结果。 |
| warning | `backend/src/routes/characterChat.ts:520` | 正确性 | analysisPrompt 中直接拼接角色回复内容，若回复包含特殊字符或注入内容，可能影响分析模型输出；同时 prompt 中要求输出 JSON 但未做解析校验。 | 对拼接内容做长度截断与转义，并对 analysisResult 做 JSON 解析容错。 |
| warning | `backend/src/routes/characterChat.ts:545` | 正确性 | createCharacterTestRun 使用 character_id: 0 表示批量测试，属于魔法值，且与真实角色 id 语义冲突（若存在 id 为 0 的角色会混淆）。 | 使用 NULL 或专门的字段/枚举表示批量测试。 |
| warning | `backend/src/routes/characterChat.ts:560` | 安全 | GET /test/runs 直接使用 database.exec 执行 SQL 并手动映射列，虽然此处无用户输入，但绕过了封装层，且 JSON.parse(obj.results) 未做 try/catch，脏数据会导致 500。 | 使用封装好的 getCharacterTestRuns，或对 JSON.parse 做容错处理。 |
| warning | `backend/src/routes/characterChat.ts:570` | 正确性 | GET /test/runs 中 dbResults[0].values.map 假设 exec 返回结构固定，若 results 为空数组但 columns 存在，逻辑尚可；但 JSON.parse 失败会抛出未捕获异常。 | 对 JSON.parse 加 try/catch 并降级为 null。 |
| warning | `backend/src/routes/characterChat.ts:600` | 可维护性 | /init-presets 与 /test/run 中预设角色定义重复，且 /init-presets 版本缺少 '你是谁' 行为规则，导致两处创建的预设角色行为不一致。 | 抽取共享常量，保证两处一致。 |
| info | `backend/src/routes/characterChat.ts:100` | 可维护性 | formatCharacter/formatConv/formatMsg 等函数参数使用 any，丢失类型安全。 | 为数据库行定义接口类型，替换 any。 |
| info | `backend/src/routes/characterChat.ts:30` | 可维护性 | toAPIConfig 参数为 any，且未校验 apiKey 等敏感字段是否存在，若缺失可能导致下游调用失败。 | 定义入参类型并校验必填字段。 |
| info | `backend/src/routes/characterChat.ts:285` | 可维护性 | maxTokens: 200 与 temperature: 0.8 在多处硬编码重复出现。 | 提取为常量或配置项。 |
| info | `backend/src/routes/characterChat.ts:1` | 可维护性 | 整个文件 674 行包含 CRUD、SSE、测试、初始化等多职责，单文件过大，不利于维护与测试。 | 按职责拆分为多个路由模块（characters、conversations、chat、test）。 |
| warning | `backend/src/services/characterPromptService.ts:27` | 正确性 | 使用 String.replace('{content}', content) 只替换第一个匹配项，且若 content 中包含特殊替换模式（如 $&、$1 等）会被当作替换语法处理，导致内容被错误替换或注入。 | 改用 replaceAll 或使用函数形式替换：EMOTION_PROMPT.replace('{content}', () => content)，避免 $ 特殊字符问题。 |
| warning | `backend/src/services/characterPromptService.ts:41` | 正确性 | JSON.parse(jsonMatch[0]) 未做 try/catch 保护，虽然外层有 catch 兜底，但一旦解析失败会直接丢弃整个结果并返回默认值，且无法区分解析失败与网络失败。 | 对 JSON.parse 单独 try/catch，或使用更健壮的解析方式，便于排查问题。 |
| warning | `backend/src/services/characterPromptService.ts:44` | 正确性 | parsed.emotion 未做类型校验，若模型返回非字符串（如数字、对象）会直接作为 emotion 返回，破坏 EmotionResult 类型契约。 | 校验 typeof parsed.emotion === 'string' 后再使用，否则回退到 '中性'。 |
| warning | `backend/src/services/characterPromptService.ts:78` | 正确性 | parseEmotionFromContent 中 parseFloat(match[2]) 未校验结果是否为有效数字，正则 [0-9.]+ 可匹配 '...' 或 '1.2.3' 等非法格式，parseFloat 会返回 NaN 或截断值。 | 解析后校验 Number.isFinite，并对强度做 clamp 到 [0,1]，非法时返回 null。 |
| info | `backend/src/services/characterPromptService.ts:78` | 可维护性 | 情绪标签列表在 EMOTION_PROMPT 和 buildSystemPrompt 中重复硬编码，两处不一致时会导致解析失败。 | 抽取为共享常量数组，两处引用同一来源。 |
| info | `backend/src/services/characterPromptService.ts:22` | 安全 | apiKey 直接来自 config，若 config 来源不可信存在泄露风险；此处仅透传，属既有设计。 | 确保 APIConfig 来源可信，避免日志打印 client 配置。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:47` | 正确性 | loadCharacters 依赖 activeCharacter，但内部又调用 setActiveCharacter，导致 useCallback 引用频繁变化；同时闭包捕获的 activeCharacter 可能过期，若已选中角色仍会被覆盖为 chars[0]。 | 使用函数式更新 setActiveCharacter(prev => prev ?? chars[0])，并将 activeCharacter 从依赖数组中移除。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:130` | 正确性 | 流式解析按 chunk 直接 split('\n')，未处理跨 chunk 被截断的 SSE 行（半行 JSON），会导致 JSON.parse 失败并静默丢弃该段内容，造成消息内容缺失。 | 维护一个 buffer，将未以换行结尾的残留片段保留到下一次 read 再拼接解析。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:137` | 正确性 | event: thinking / event: delta 分支为空注释，实际依赖 data 行内容判断；若后端 data 行不含 status/content 等字段，事件会被静默忽略，逻辑脆弱。 | 显式解析 event 行并保存当前事件类型，再根据事件类型处理后续 data 行。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:152` | 正确性 | 更新最后一条消息时假设 updated.length-1 一定是 assistant 占位消息，若期间有并发 setMessages（如用户再次发送）会写错消息对象。 | 用占位消息的 id 定位并更新，而非依赖数组末尾位置。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:100` | 正确性 | userMsg 与 assistantPlaceholder 使用 Date.now() 和 Date.now()+1 作为 id，快速连续发送时可能与其他消息 id 冲突。 | 使用 crypto.randomUUID() 或递增计数器生成临时 id。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:96` | 正确性 | sendMessage 在 config/activeConversation/activeCharacter 缺失时直接 return，无任何错误提示，用户点击发送无反馈。 | 设置 error 状态提示用户（如未配置模型或未选择会话）。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:118` | 正确性 | 未在发送前 abort 上一次未完成的请求，若用户快速连续发送，多个流会并发写入同一 messages 数组，导致内容错乱。 | 发送前调用 abortRef.current?.abort() 取消上一次流。 |
| warning | `frontend/src/hooks/useCharacterChat.ts:178` | 正确性 | catch 中仅处理 AbortError，但 finally 无条件将 abortRef.current 置 null；若旧请求的 finally 在新请求启动后执行，会清空新请求的 abortRef，导致 stopStreaming 失效。 | 在 finally 中判断 abortRef.current === abortController 再置 null。 |
| info | `frontend/src/hooks/useCharacterChat.ts:60` | 可维护性 | 多处 catch (err: any) 后直接 setError(err.message)，未做类型收窄，err 可能非 Error 实例导致 message 为 undefined。 | 统一封装错误提取函数，如 err instanceof Error ? err.message : String(err)。 |
| info | `frontend/src/hooks/useCharacterChat.ts:1` | 可维护性 | 组件卸载时未 abort 进行中的流请求，可能造成内存泄漏或卸载后 setState 警告。 | 增加 useEffect 清理函数，在卸载时调用 abortRef.current?.abort()。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:44` | 正确性 | character.name[0] 在 name 为空字符串时返回 undefined，会渲染出空白头像；同理 MessageBubble 中 character.name[0] 也有相同问题。 | 使用 character.name?.[0] ?? '?' 做兜底，或对 name 做非空校验。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:62` | 正确性 | displayContent 仅剥离开头的情绪标签，若消息内容中段或结尾包含 [情绪:xxx] 标签会原样展示给用户。 | 使用全局正则 replace(/\[情绪:[^\]]+\]\s*/g, '') 或在数据层统一剥离。 |
| info | `frontend/src/pages/CharacterChatPage.tsx:76` | 可维护性 | 用户头像硬编码为字符 'V'，含义不明，属于魔法值。 | 提取为常量或使用用户昵称首字母，并加注释说明。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:88` | 正确性 | 判断用户消息加载态使用 message.content === ''，但 displayContent 已剥离情绪标签，若用户消息内容为空字符串会同时显示 '...' 和加载动画，逻辑不一致。 | 统一用 message.content 是否为空来判断加载态，并避免同时渲染 '...'。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:130` | 可维护性 | testResult 使用 any 类型，且后续 testResult.results?.map((charResult: any) => ...) 中大量 any，丢失类型安全。 | 为测试结果定义明确的接口类型（如 TestResult、CharacterTestResult、TestItem）。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:168` | 正确性 | handleRunTest 中 modelWithKey.apiKey! 使用非空断言，虽然前面用 find(m => m.apiKey) 过滤，但类型上仍不安全；若 apiKey 为空字符串也会通过 find 判断。 | 改为显式判断 if (!modelWithKey.apiKey) 并给出错误提示，避免非空断言。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:175` | 安全 | 将 apiKey 明文放入 config 对象并传给 characterChatApi.runTest，若该请求经前端直连第三方或日志记录，存在密钥泄露风险。 | 确认 runTest 是否必须由前端携带密钥；优先由后端代理调用，避免密钥出现在前端请求体中。 |
| info | `frontend/src/pages/CharacterChatPage.tsx:183` | 可维护性 | catch (err: any) 使用 any，且仅取 err.message，非 Error 类型时可能为 undefined。 | 使用 unknown 并做类型收窄，如 err instanceof Error ? err.message : String(err)。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:232` | 正确性 | 对话列表项外层是 <button>，内部又嵌套了一个删除用的 <button>，HTML 中 button 不能嵌套 button，会导致无效 DOM 与事件行为异常。 | 将外层改为 div 并加 role/onClick，或把删除按钮移出外层按钮。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:236` | 正确性 | deleteConversation(conv.id) 未做确认，且未 await/处理失败；误触会直接删除对话。 | 增加确认弹窗，并处理删除失败的错误提示。 |
| info | `frontend/src/pages/CharacterChatPage.tsx:300` | 可维护性 | 多处硬编码颜色值 #6c5ce7 / #a29bfe / #2d3a5c 等散落在 className 与 style 中，未走主题变量。 | 提取为 Tailwind 主题色或常量，统一维护。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:340` | 正确性 | 发送按钮在 isStreaming 时显示 Square 图标，但 onClick 仍绑定 handleSend（handleSend 内部会因 isStreaming 直接 return），点击不会停止流式输出，与图标语义不符。 | isStreaming 时 onClick 应调用 stopStreaming，或改为禁用状态。 |
| info | `frontend/src/pages/CharacterChatPage.tsx:372` | 可维护性 | 测试面板文案中硬编码“4 个预设角色”“50 条对话”“24轮对话”等数字，与实际逻辑（characters.filter(isPreset)）可能不一致。 | 根据实际角色数量动态计算文案，或提取常量。 |
| info | `frontend/src/pages/CharacterChatPage.tsx:470` | 可维护性 | testResult.analysis.substring(0, 2000) 与 test.response.substring(0, 80) 使用魔法数字截断，且截断后无提示。 | 提取常量并加注释说明截断原因，或提供展开查看完整内容。 |
| warning | `frontend/src/pages/CharacterChatPage.tsx:480` | 安全 | 使用 <pre> 直接渲染 testResult.analysis 文本，React 默认转义不会 XSS，但若后续改为 dangerouslySetInnerHTML 会有风险；当前虽安全，但分析内容来自模型输出，建议明确保持纯文本渲染。 | 保持文本渲染，避免引入 dangerouslySetInnerHTML；如需富文本需做 sanitize。 |
| warning | `frontend/src/pages/CharacterGenPage.tsx:208` | 正确性 | 当 selectedSize 使用 ':' 格式（如 '16:9'）时，aspectRatio 被设置为字符串 '16/9'，而原 'x' 分支返回的是数值。CSS aspect-ratio 虽可接受 '16/9' 字符串，但同一属性在不同分支返回不同类型（string vs number），行为不一致且易引发后续维护困惑。 | 统一返回数值，例如对 ':' 格式也做 split(':').map(Number).reduce((a,b)=>a/b,1)，保证类型一致。 |
| warning | `frontend/src/pages/CharacterGenPage.tsx:208` | 正确性 | 若 selectedSize 既不含 ':' 也不含 'x'（如空字符串或非法值），split('x') 得到单元素数组，reduce 返回初始值 1，虽不崩溃但会静默产生错误宽高比；且 ':' 分支未校验格式合法性。 | 增加格式校验或默认值回退，例如解析失败时返回 1 并记录告警。 |
| info | `frontend/src/pages/CharacterGenPage.tsx:208` | 可维护性 | aspectRatio 计算逻辑内联在 JSX 中，包含三元表达式与链式调用，可读性较差，且与下方 selectedSize.replace('x',' × ') 的展示逻辑分散。 | 抽取为 useMemo 或独立函数（如 getAspectRatio(selectedSize)），并统一处理 ':' 与 'x' 两种格式。 |
| warning | `frontend/src/services/api.ts:213` | 可维护性 | createCharacter/updateCharacter 的 data 参数类型为 any，丢失类型安全，调用方无法获得字段提示，也容易传入错误结构。 | 定义 CharacterPayload 等具体接口类型替代 any，例如 createCharacter: async (data: CharacterPayload)。 |
| warning | `frontend/src/services/api.ts:245` | 正确性 | sendMessage 直接使用硬编码路径 `/api/character-chat/...` 而非复用已配置 baseURL 的 api 实例，若 api 的 baseURL 与 '/api' 不一致（如带前缀或环境变量），会导致请求地址错误。 | 从 api 实例读取 baseURL 或统一通过配置常量拼接路径，避免硬编码 '/api' 前缀。 |
| warning | `frontend/src/services/api.ts:245` | 安全 | sendMessage 使用原生 fetch 未携带 api 实例上的认证头（如 Authorization token），若后端接口需要鉴权，该请求会 401 或越权失败。 | 复用 api 实例的拦截器/默认 headers，或显式从 api.defaults.headers 中取出认证头附加到 fetch 请求。 |
| info | `frontend/src/services/api.ts:245` | 可维护性 | sendMessage 未检查 response.ok，调用方需自行判断 HTTP 状态，容易遗漏错误处理。 | 在返回前判断 response.ok，非 2xx 时抛出带状态码的错误，或返回统一的结果对象。 |
| info | `frontend/src/services/api.ts:187` | 可维护性 | 新增的 characterChatApi 中所有方法均未声明返回类型，依赖 response.data 的隐式 any，降低类型可读性。 | 为各方法补充明确的返回类型（如 Promise<Character[]>、Promise<Conversation> 等）。 |
| info | `frontend/src/types/index.ts:104` | 可维护性 | EMOTION_CONFIG 的 key 与 label 完全重复（如 '开心': { label: '开心' }），label 字段冗余，且使用中文字符串作为对象 key 不利于类型安全与国际化。 | 考虑将 label 抽离为独立的 i18n 映射，或使用英文枚举作为 key（如 'happy'）并配合映射表，避免中文 key 与 label 重复。 |
| info | `frontend/src/types/index.ts:104` | 可维护性 | EMOTION_CONFIG 使用 Record<string, ...> 而非更精确的联合类型，emotion 字段（CharacterChatMessage.emotion）为 string \| null，无法在编译期约束取值，容易与后端返回的情绪值不一致。 | 定义 EmotionType 联合类型（如 '开心' \| '伤心' \| ...），将 EMOTION_CONFIG 声明为 Record<EmotionType, ...>，并让 emotion 字段使用该类型。 |
| info | `frontend/src/types/index.ts:104` | 可维护性 | EMOTION_CONFIG 是运行时常量，却与纯类型定义混放在 types/index.ts 中，可能导致该文件被引入时携带运行时依赖，影响 tree-shaking。 | 将 EMOTION_CONFIG 等运行时常量移至独立的 constants 文件（如 constants/emotion.ts），types 文件仅保留类型声明。 |
