GitHub 仓库 AI 评审平台实现事先计划
‌结论先行：完全可以实现。‌ GitHub 生态有成熟的分支保护、Actions 工作流、Webhook、PR Review API 等基础设施，可以 1:1 复刻百度内部那套「提交拦截 → 评审链接 → AI评审 → 合并放行」的闭环流程。

以下是完整的事先实施计划。

一、目标与范围
1.1 要实现的核心能力
对应你描述的四个环节，在 GitHub 上的映射关系：

表格
百度内部流程	GitHub 对应实现	核心机制
提交代码拦截	分支保护规则（Branch Protection）	禁止直接 push 到 main/master，必须走 PR
生成评审链接	PR 自动创建 + 状态检查	每个 PR 就是天然的评审入口，附带 diff/上下文
AI 评审	GitHub Actions + 大模型 API	PR 事件触发，调用模型分析后回写评论
允许合并	必需状态检查（Required Status Checks）	AI 评审未通过 → 合并按钮置灰，无法合并
1.2 不做什么（边界）
不替代人工评审，AI 是「第一道防线」而非最终裁决者
不做自动合并（建议保留人工确认环节）
不处理超大 PR（超过设定阈值降级为仅摘要评审）
二、整体架构设计
2.1 架构全景图
text
开发者 push 功能分支
        ↓
[GitHub 分支保护]  拦截直接推送到 main
        ↓
开发者创建 PR（或自动创建）
        ↓
[GitHub Webhook/Actions]  捕获 pull_request 事件
        ↓
[AI 评审引擎]
   ├─ 拉取 PR diff + 变更文件列表
   ├─ 过滤非代码文件（锁文件、生成文件、二进制）
   ├─ 静态检查预跑（lint / SAST / 依赖扫描）
   ├─ 上下文增强（提取函数定义、关联文档）
   ├─ 调用大模型 API 进行语义级评审
   └─ 生成结构化评审报告
        ↓
[结果回写]  PR 评论 + 状态检查标记（pass/fail）
        ↓
[合并门禁]  分支保护规则校验状态检查结果
        ↓
人工复核 → 批准 → 合并
2.2 两种部署形态选型
表格
对比维度	方案 A：GitHub Actions 轻量化	方案 B：GitHub App + 独立服务
‌部署成本‌	极低，仓库内配 workflow 即可	中等，需服务器 + Webhook 处理
‌运维复杂度‌	几乎为零	需处理服务可用性、重试、鉴权
‌多仓库管理‌	每个仓库一份配置	统一管理，组织级部署
‌状态持久化‌	无（每次冷启动）	有（可存数据库、做统计分析）
‌响应实时性‌	冷启动慢（30s~1min）	快（秒级响应）
‌适合场景‌	单仓库/小团队快速验证	团队级/组织级统一治理
‌建议路线‌：先用方案 A 快速跑通闭环，验证效果后再评估是否升级到方案 B。

三、分阶段实施计划
阶段一：基础门禁搭建（第 1 周）
‌目标‌：先把「拦得住」的基础设施搭好，不涉及 AI。

‌任务清单‌：

‌配置分支保护规则‌

仓库 Settings → Branches → 为 main/master 添加保护规则
启用：Require pull request reviews before merging（至少 1 人审批）
启用：Require status checks to pass before merging
启用：Require branches to be up to date before merging
启用：Do not allow bypassing the above settings（管理员也不能绕过）
关闭：Allow force pushes / Allow deletions
‌配置基础 CI 流水线‌

编写 .github/workflows/ci.yml
包含：代码格式检查（lint）、单元测试、构建验证
确保这些 job 的名称在分支保护中被选为必需状态检查
‌PR 模板与规范‌

建立 .github/pull_request_template.md
要求填写：变更描述、关联 Issue、测试验证、自检清单
‌交付物‌：分支无法直接 push，必须走 PR；CI 不通过无法合并。

阶段二：AI 评审 MVP（第 2-3 周）
‌目标‌：跑通 AI 评审完整链路，能自动出评论。

‌任务清单‌：

‌大模型选型与 API 配置‌

选型参考：DeepSeek（性价比高）、GPT-4o（质量好）、Claude 3.5 Sonnet（代码理解强）
在仓库 Secrets 中配置 API Key（如 OPENAI_API_KEY / DEEPSEEK_API_KEY）
‌编写 AI 评审工作流‌

新建 .github/workflows/ai-review.yml
触发条件：pull_request 的 opened、synchronize、reopened 事件
跳过 Draft PR 和仅文档变更的 PR
‌核心评审脚本实现‌

用 GitHub API 获取 PR diff（Accept: application/vnd.github.v3.diff）
Diff 预处理：
过滤非代码文件（.md、package-lock.json、*.lock、图片等）
按文件拆分，超大文件（>500行变更）降级处理
提取变更函数的上下文（前后各 20 行）
Prompt 设计（建议三维度）：
Bug 风险：空指针、资源泄露、并发问题、逻辑错误
安全问题：SQL 注入、XSS、硬编码密钥、越权访问
可维护性：命名规范、冗余代码、魔法数字、注释缺失
约束输出格式：JSON 结构，包含文件、行号、严重级别、问题描述、修改建议
‌结果回写‌

用 GITHUB_TOKEN 调用 GitHub API 在 PR 下发表评论
评论格式：总览摘要 + 分文件问题列表 + 严重级别标记
设置状态检查（Status Check）：ai-review/pass 或 ai-review/fail
‌交付物‌：PR 创建后 2-3 分钟内自动收到 AI 评审评论，状态检查显示通过/失败。

阶段三：合并门禁与质量优化（第 4 周）
‌目标‌：把 AI 评审变成强制门禁，同时降低误报、提升体验。

‌任务清单‌：

‌启用 AI 评审为必需状态检查‌

在分支保护规则中，将 ai-review 加入 Required status checks
验证：AI 评审失败时，合并按钮置灰
‌误报控制机制‌

严重级别分层：blocker（阻塞合并）、warning（提示不阻塞）、info（仅建议）
仅 blocker 级别的问题触发失败状态
增加指纹去重：同一问题不因新 push 重复评论
支持「忽略标记」：开发者在评论中回复 /ai-ignore 可跳过特定问题（需记录审计）
‌体验优化‌

行级评论（Review Comment）：直接在对应代码行下方评论，而非一条总评论
并发控制：同一 PR 多次 push 时，取消前一次评审（避免浪费 token）
成本控制：按文件大小/变更行数设置 token 预算上限
进度提示：评审中显示「AI 评审进行中...」状态
‌规则定制化‌

支持仓库级配置文件（.ai-review.yml）：自定义检查规则、排除路径、语言偏好
不同语言/框架使用不同 prompt 模板
接入项目特定的编码规范文档（作为上下文喂给模型）
‌交付物‌：AI 评审正式生效为合并门禁，误报率可控，开发者体验顺畅。

阶段四：组织级推广与运营（第 5-6 周及以后）
‌目标‌：从单仓库推广到多仓库，建立持续优化机制。

‌任务清单‌：

‌组织级部署（可选升级到方案 B）‌

开发 GitHub App，安装到组织内所有仓库
统一管理规则配置、模型版本、密钥
建立评审后台：统计各仓库评审数据
‌质量度量体系‌

核心指标：
高严重问题召回率（漏检率）
误报率（开发者忽略率）
评审平均耗时（P50/P95）
单次评审 token 成本
建议采纳率
每月复盘，迭代 prompt 和规则
‌闭环优化‌

收集开发者标记的误报和漏报，沉淀为测试用例
定期用历史数据回归测试，评估模型版本升级效果
将确认的真实缺陷样本加入微调训练集（如使用私有模型）
‌高级特性（按需）‌

上下文增强：接入向量数据库，检索项目历史代码和文档
多模型路由：简单 PR 用便宜模型，复杂 PR 自动升级到强模型
与安全扫描联动：CodeQL / Dependabot 结果整合进 AI 评审
自动修复建议生成：不仅指出问题，还给出 fix 补丁
四、关键技术点与实现方案
4.1 「提交拦截」的实现
‌核心手段‌：GitHub Branch Protection Rules
‌关键点‌：必须勾选「Include administrators」，否则管理员可以绕过
‌加强版‌：使用 Rulesets（组织级规则），可跨仓库统一配置，比单仓库分支保护更强
4.2 「AI评审状态作为合并门禁」的实现
GitHub 的 Required Status Checks 机制是关键：

Actions 工作流中通过 API 创建 commit status（pending → success / failure）
分支保护中把这个 status 设为 required
只有 status 为 success 时 PR 才能合并
yaml
# 工作流中设置状态检查示例
- name: Set AI review status
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.repos.createCommitStatus({
        owner: context.repo.owner,
        repo: context.repo.repo,
        sha: context.payload.pull_request.head.sha,
        state: '${{ needs.review.outputs.result }}', // success / failure
        context: 'ai-code-review',
        description: 'AI 代码评审已完成',
        target_url: context.payload.pull_request.html_url
      })
4.3 Prompt 设计要点
避免「泛泛而谈」的核心是结构化约束：

明确输出 JSON Schema，要求按字段填写
要求必须指出具体行号，禁止空泛评价
加入「没把握就别说」的约束，降低误报
多轮校验：先生成问题列表，再自检一遍置信度
针对不同语言提供专门的 system prompt
4.4 权限与安全
‌最小权限原则‌：GITHUB_TOKEN 只授予 pull-requests: write 和 contents: read
‌代码不泄露‌：如果对数据敏感，考虑使用自托管 runner + 本地部署模型
‌Secret 管理‌：API Key 存在 GitHub Secrets / 组织级 Secrets 中，不要硬编码
‌审计日志‌：记录每次评审的 prompt、模型版本、输出结果，便于追溯
五、成本估算（以 GitHub Actions + DeepSeek 为例）
表格
项目	估算	说明
单次 PR 评审 token 消耗	4,000 ~ 12,000 tokens	200~500 行变更的中型 PR
单次评审 API 成本	约 0.01 ~ 0.05 元人民币	DeepSeek 约 ¥2/百万 tokens
GitHub Actions 运行时间	2~5 分钟/次	公共仓库 2000 分钟/月免费
每月 100 个 PR 总成本	约 5 ~ 20 元	几乎可以忽略不计
六、风险与应对
表格
风险	影响	应对措施
‌AI 误报多‌	开发者不信任，关掉评审	分层严重级别，仅 blocker 阻塞；持续收集反馈迭代 prompt
‌大 PR 上下文溢出‌	评审质量下降	按文件分块评审，超大 PR 降级为摘要模式
‌API 调用失败‌	评审卡住，影响开发节奏	设置超时与重试；失败时标记为 warning 而非阻塞
‌代码外发安全顾虑‌	企业合规风险	用自托管 runner + 内部部署模型（如 Ollama + DeepSeek 本地版）
‌Token 成本超支‌	费用不可控	设置每日/每仓库调用上限；过滤非必要文件；并发去重
‌开发者绕过‌	流程失效	分支保护勾选管理员也不绕过；审计日志监控异常合并
七、第一周行动清单（快速启动）
如果你想立刻上手，第一周可以按这个顺序做：

✅ 找一个测试仓库，开启 main 分支保护
✅ 配置好基础 CI（lint + test）并设为必需状态检查
✅ 申请一个大模型 API Key（推荐先试 DeepSeek，便宜且效果好）
✅ 写一个最简版 ai-review.yml：PR 创建时打印 diff
✅ 接入模型 API，跑通第一条 AI 评论
✅ 在分支保护中把 AI 评审设为必需状态检查
✅ 团队内测一周，收集反馈调 prompt