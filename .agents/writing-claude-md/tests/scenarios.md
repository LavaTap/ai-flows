# 测试场景

修改技能后逐场景跑通，验证渐进式披露和问答流无回归。

## 场景 A：简单 FastAPI 项目（最小输出）

**输入项目：**
```
pyproject.toml (fastapi, uvicorn, pydantic; 无 DI 框架)
ruff 配置（E/W/F/I/S/B）
pytest 配置
README.md: "A FastAPI project"
无分层目录结构、无质量门禁
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Python 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | FastAPI, Pydantic, Uvicorn（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | pytest, ruff（全选） | 确认 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过（候选推荐池为空或无采纳） | — |
| 步骤 3 | 阶段 C | C1 测试策略 | 最小测试 | 测试: 不写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 基本校验 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | 跳过 | — |

**步骤 2 技术栈扫描预期：**
- 依赖声明：pyproject.toml 中 fastapi, uvicorn, pydantic → 技术栈清单: FastAPI + Pydantic + Uvicorn
- 源码模式：无 async/await 函数定义 → 全同步

**步骤 2 覆盖分析预期：**

Tier 1 前置检查：
- DI 注入规则 → 无 dishka/di 依赖 → 不适用 ✅
- 全局状态 Final → 适用 → 必须保留 ✅

Tier 2：
- 分层约束 → 无 domain 层 → 不适用 ✅
- 通用类库 → 适用 → 等待阶段 A 确认
- async/同步 → 适用 → 步骤 4 自动推断
- 异常处理 → 适用 → 步骤 4 自动推断
- 日志规范 → 无 structlog → 不适用 ✅
- 测试框架 → 适用 → 等待阶段 C 确认
- 安全边界 → 适用 → 等待阶段 C 确认

Tier 3：
- dataclass frozen → 无 domain 层 → 不适用 ✅
- 维护同步义务 → 无质量门禁 → 不适用 ✅
- 路径/ID 校验 → 适用但默认不纳入
- API 枚举 → 适用但默认不纳入

**步骤 4 生成预期：**
- 标题 + 项目身份: ~3 行
- 适用范围: ~3 行
- 命令表: ~5 行
- 核心架构规则: Final + async/同步（反直觉）→ ~25 行
- 代码风格（扩展至达标）: ~15 行
- 测试规范（扩展至达标）: ~12 行
- 红线: ~3 行
- **总计: ~66 行核心 + 扩展至 ≥150 行**
- 扩展来源：核心规则增加 ✅/❌ 示例 → 测试模式说明 → 代码风格细化

**步骤 4 自动推断：**
- 分层架构：无分层目录→无架构（不写入）
- DI 方式：无 DI 框架→无 DI（不写入）
- 异常处理：无统一异常→简单 try-catch（不写入）
- 同步/异步：FastAPI + 全同步代码→async 反直觉（写入）

**通过判定：**
- [ ] 生成的 CLAUDE.md 不包含 DI 相关内容
- [ ] 包含 async/同步规则（反直觉：FastAPI 全同步）
- [ ] 不包含分层架构规则
- [ ] 不包含 Tier 3 内容
- [ ] ≥ 150 行（通过扩展代码示例和测试规范达标）
- [ ] 红线回顾在末尾

---

## 场景 B：复杂 DDD + DI 项目（接近上限）

**输入项目：**
```
pyproject.toml (fastapi, dishka, pydantic, structlog, uvicorn, company-common-utils)
ruff 配置 + ast-grep + import-linter
质量门禁: .quality_gate/ 目录
目录结构: src/domain/, src/application/, src/interface/, src/infrastructure/
README.md: "DDD-based FastAPI service"（含架构概览段落）
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Python 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | FastAPI, Dishka, Pydantic, Structlog（全选） | 确认 |
| 步骤 3 | 阶段 A | 数据与存储 | 无 | — |
| 步骤 3 | 阶段 A | 开发工具 | ast-grep, import-linter（全选） | 确认 |
| 步骤 3 | 阶段 A | 内部类库 | company-common-utils（勾选） | Explore Agent 探测 |
| 步骤 3 | 阶段 B | 优化推荐 | "建议添加统一异常处理"（部分采纳） | 候选池内容 |
| 步骤 3 | 阶段 C | C1 测试策略 | 测试覆盖要求 | 测试: 写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 严格边界校验 | 安全: 写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | "Provider 同步更新 PROHIBITED_INSTANTIATION" | 写入 |

**步骤 2 技术栈扫描预期：**
- 依赖声明：fastapi, dishka, pydantic, structlog, company-common-utils → 技术栈清单: FastAPI + Dishka + Pydantic + Structlog + company-common-utils
- 源码模式：无 async def → 全同步
- 目录信号：src/domain/, src/application/, src/infrastructure/ → DDD 分层

**步骤 2 覆盖分析预期：**

Tier 1 前置检查：
- DI 注入规则 → 有 dishka → 适用 → 必须保留 ✅
- 全局状态 Final → 适用 → 必须保留 ✅

Tier 2：
- 分层约束 → 有 domain/application 层 → 适用 → 步骤 4 自动推断
- 通用类库 → 有 company-common-utils → 阶段 A 确认触发 Explore 探测
- async/同步 → 适用 → 步骤 4 自动推断
- 异常处理 → 适用 → 步骤 4 自动推断（阶段 B 采纳统一异常推荐后写入）
- 日志规范 → 有 structlog → 适用 → 候选推荐池
- 测试框架 → 适用 → 等待阶段 C 确认
- 安全边界 → 适用 → 等待阶段 C 确认

Tier 3：
- dataclass frozen → 有 domain 层 → 适用
- 维护同步义务 → 有质量门禁 → 适用
- 路径/ID 校验 → 适用
- API 枚举 → 适用

**步骤 4 生成预期：**
- 标题 + 项目身份: ~3 行
- 适用范围: ~3 行
- 命令表: ~8 行
- 核心架构规则: DI 注入 + Final + 分层 + 异常 + async + 安全 + 通用类库 → ~60 行
- 通用类库依赖: ~8 行（阶段 A 确认触发 Explore 生成）
- 代码风格: ~15 行
- 测试规范: ~15 行
- 维护义务 (C3): ~10 行
- Tier 2 通用池：日志规范（已生成内容 < 120 行时纳入）→ ~10 行
- 红线: ~3 行
- **总计: ~135 行核心 + 扩展至 ≥150 行**
- 扩展来源：核心规则增加边界情况示例 → 测试模式说明 → 代码风格细化

**步骤 4 自动推断：**
- 分层架构：domain/application/infrastructure → DDD（写入）
- DI 方式：dishka 框架→自动 DI（写入）
- 异常处理：阶段 B 采纳统一异常推荐→全局拦截（写入），否则各层独立
- 同步/异步：FastAPI + 全同步代码→async 反直觉（写入）

**通过判定：**
- [ ] 包含 DI 注入规则 + ✅/❌ 示例
- [ ] 包含分层架构规则（自动推断 DDD）
- [ ] 包含通用类库依赖表格（阶段 A 确认触发 Explore 生成）
- [ ] 包含 async/同步规则（标注反直觉）
- [ ] 包含维护同步义务（C3 激活）
- [ ] 不包含 dataclass frozen（Tier 3 未被 C3 提及）
- [ ] 日志规范是否纳入取决于已生成内容是否 < 120 行
- [ ] ≥ 150 行
- [ ] ≤ 250 行
- [ ] 红线回顾在末尾

---

## 场景 C：增量更新

**输入项目：**
```
已有 CLAUDE.md（旧版，不含渐进式披露产出的结构）
场景 B 的项目结构
```

**步骤 1：** 检测到已有 CLAUDE.md → 内部判定增量更新模式

**步骤 4b 预期行为：**
- [ ] 输出差异建议表（旧版内容 vs 分析结果）
- [ ] 标记：保留 / 删除 / 新增 / 合并
- [ ] 标注文档覆盖（旧版中与 README 重复的内容 → 建议提纯）
- [ ] 用户确认后合并

---

## 场景 D：触发精确性测试

**应触发的查询（正例）：**
1. "帮我创建这个项目的 CLAUDE.md"
2. "项目需要一份 AI 编码规范文件"
3. "生成 CLAUDE.md"
4. "更新项目指令文件"
5. "这个项目需要 CLAUDE.md 吗"
6. "帮我写 AGENTS.md"
7. "优化现有的 CLAUDE.md"
8. "重构项目级 AI 指令"
9. "给项目加上编码规范文档给 AI 用"
10. "初始化项目规范文件"

**不应触发的近似查询（反例）：**
1. "帮我写 README"（README ≠ CLAUDE.md）
2. "添加代码注释"（注释 ≠ 指令文件）
3. "创建 .editorconfig"（editorconfig ≠ AI 指令）
4. "写 API 文档"（API 文档 ≠ 编码规范）
5. "配置 ESLint"（linter 配置 ≠ AI 指令）
6. "帮我写 CONTRIBUTING.md"（贡献指南 ≠ AI 指令文件）
7. "给函数加 type hints"（类型注解 ≠ 项目规范）
8. "整理项目目录结构"（目录整理 ≠ 规范文件）

**通过判定：**
- [ ] 正例触发率 ≥ 90%（10 条中 ≥ 9 条触发）
- [ ] 反例误触发率 ≤ 10%（8 条中 ≤ 1 条误触发）

---

## 场景 E：技术栈全覆盖验证

**目的：** 验证阶段 A 技术栈确认（multiSelect）和架构模式自动推断。

**输入项目：**
```
pyproject.toml (flask, sqlalchemy, pytest, pytest-cov; 无 DI 框架)
目录结构: app/controllers/, app/models/, app/templates/, app/services/
ruff 配置
.company_utils/ (内部类库: logging_middleware.py, auth_decorator.py)
无全局异常处理
pytest 配置 + conftest.py (仅基础 fixture)
pyproject.toml [tool.coverage.run] branch = true
pyproject.toml [tool.coverage.report] fail_under = 80
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Python 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | Flask, SQLAlchemy（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | pytest（全选） | 确认 |
| 步骤 3 | 阶段 A | 内部类库 | .company_utils（勾选） | Explore Agent 探测 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | 覆盖要求: pytest-cov ≥ 80% | 测试: 写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 基本校验 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | 跳过 | — |

**步骤 2 技术栈扫描预期：**
- 依赖声明：flask, sqlalchemy, pytest, pytest-cov → 技术栈清单: Flask + SQLAlchemy + pytest + pytest-cov
- 目录信号：app/controllers/, app/models/, app/templates/ → MVC 结构
- 源码模式：无 @app.errorhandler → 无全局异常处理

**步骤 4 自动推断：**
- 分层架构：controllers/models/templates → MVC（写入）
- DI 方式：无 DI 框架→无 DI（不写入）
- 异常处理：无统一异常→简单 try-catch（不写入）
- 同步/异步：Flask + 全同步代码→非反直觉（不写入）

**步骤 4 生成预期：**
- MVC 分层约束（controllers 路由转发 / models 数据映射 / services 业务逻辑）
- 通用类库依赖表（Explore Agent 自动探测 .company_utils/ → logging_middleware + auth_decorator）
- 测试覆盖规则（pytest-cov ≥ 80%）
- 不含 DI 规则、全局异常规则、async 规则、安全边界规则

**通过判定：**
- [ ] 阶段 A 技术栈确认包含所有框架与核心、开发工具、内部类库选项
- [ ] 架构模式从目录信号自动推断为 MVC（非问答驱动）
- [ ] MVC 分层约束规则写入（✅ controller 仅路由 / ❌ controller 含业务逻辑）
- [ ] 通用类库依赖来自 Explore Agent 自动探测（阶段 A 确认触发）
- [ ] 测试覆盖规则包含 fail_under 阈值（阶段 C 确认）
- [ ] 不含 DI、全局异常、async、安全边界规则
- [ ] ≥ 150 行

---

## 场景 F：最小配置 + 语言纠正

**目的：** 覆盖 Q1 语言纠正、阶段 C 无特殊要求。

**输入项目：**
```
build.gradle.kts (Kotlin Ktor 项目；检测为 Java)
src/main/kotlin/com/example/
src/test/kotlin/com/example/
application.conf (Ktor 配置)
无分层目录、无 DI 框架、无质量门禁
已有 CLAUDE.md（旧版，约 80 行）
```

**步骤 1：** 检测到已有 CLAUDE.md → 内部判定全量重写模式

**步骤 1 预期：**
- 初始检测 build.gradle.kts → 推断 Java
- Q1 用户纠正 → Kotlin
- 无 references/kotlin.md → 按 JVM 语言通用规则 + Kotlin 特性处理

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 语言确认？ | Kotlin（纠正） | — |
| 步骤 3 | 阶段 A | 框架与核心 | Ktor（勾选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | 跳过 | — |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | 无特殊要求 | 测试: 不写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 无特殊要求 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | 跳过 | — |

**步骤 4 自动推断：**
- 分层架构：无分层目录→无架构（不写入）
- DI 方式：无 DI 框架→无 DI（不写入）
- 异常处理：无统一异常→简单 try-catch（不写入）
- 同步/异步：Ktor + 全同步代码→async 反直觉（写入）

**步骤 4 生成预期：**
- Tier 1 必选规则 + async/同步规则（Ktor 反直觉）+ 命令表 + 红线
- Kotlin 特有规则从代码结构推断（data class、suspend 函数等）
- 扩展 ✅/❌ 代码示例至 ≥ 150 行

**通过判定：**
- [ ] Q1 语言纠正后加载正确的语言特性（Kotlin 而非 Java）
- [ ] 无 references/kotlin.md 时不报错，改为从代码推断
- [ ] 包含 async/同步规则（反直觉：Ktor 全同步）
- [ ] 阶段 C"无特殊要求"不生成测试/安全规则
- [ ] ≥ 150 行
- [ ] 红线回顾在末尾

---

## 场景 G：手动选项未覆盖分支

**目的：** 覆盖简单分层、手动DI、各层独立异常、混合异步、TDD。

**输入项目：**
```
pom.xml (无 Spring，纯 Servlet + JDBI)
目录结构: src/main/java/com/example/api/, service/, dao/, model/
checkstyle.xml
JUnit 5 + 测试文件结构完整（test/ 目录结构与 src/ 对称，TDD 特征）
Factory 类: com.example.service.ServiceFactory
各层独立 try-catch（DAO → RuntimeException，Service → BusinessException）
Servlet AsyncContext 异步 + 同步 doGet/doPost 混合
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Java 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | Servlet, JDBI（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | JUnit 5（全选） | 确认 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | TDD优先 | 测试: 写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 基本校验 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | "DAO 层禁止抛出受检异常" | 写入 |

**步骤 2 技术栈扫描预期：**
- 依赖声明：pom.xml 中 JDBI、Servlet API、JUnit 5 → 技术栈清单: Servlet + JDBI + JUnit5
- 源码模式：ServiceFactory 类 → 手动 DI；各层独立 try-catch → 各层独立异常
- 目录信号：api/, service/, dao/, model/ → 简单分层

**步骤 4 自动推断：**
- 分层架构：api/service/dao/model → 简单分层（写入）
- DI 方式：ServiceFactory 工厂→手动 DI（写入）
- 异常处理：各层独立 try-catch→各层独立异常（写入）
- 同步/异步：AsyncContext + 混合代码→混合模式（不写入）

**步骤 4 生成预期：**
- 轻量分层约束（api/service/dao 职责边界，无 DDD 严格规则）
- 工厂模式 DI 规则（ServiceFactory 职责、禁止直接 new Service）
- 各层独立异常处理（DAO → RuntimeException / Service → BusinessException / API → HTTP 映射）
- TDD 流程规范（红-绿-重构、测试先行）
- 维护义务：DAO 异常规则

**通过判定：**
- [ ] 架构模式自动推断为简单分层 + 手动 DI + 各层独立异常
- [ ] 包含工厂模式 DI 规则（非 Spring 自动注入）
- [ ] 包含各层独立异常处理规则（三层异常边界不同）
- [ ] 包含 TDD 流程规范
- [ ] 包含"DAO 层禁止抛出受检异常"（C3 激活）
- [ ] 不包含全局异常拦截规则
- [ ] 不包含 async/同步规则（混合模式下不约束）
- [ ] 不包含通用类库规则
- [ ] ≥ 150 行

---

## 场景 H：前端 React + Next.js（全异步）

**目的：** 覆盖前端语言检测、Next.js 框架、架构模式自动推断、前端检测信号（状态管理、认证、i18n）。

**输入项目：**
```
package.json (next, react, @tanstack/react-query, next-intl, next-auth, vitest, @testing-library/react)
next.config.mjs
app/ 目录（Next.js App Router: layout.tsx, page.tsx, loading.tsx）
middleware.ts（NextAuth 路由守卫）
messages/en.json, messages/zh.json（i18n）
vitest.config.ts + __tests__/ 目录
.env（NEXT_PUBLIC_API_URL）
prettier + eslint + prettier-plugin-tailwindcss
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 前端确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | Next.js, React, TanStack Query, next-intl, NextAuth（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | vitest, @testing-library/react（全选） | 确认 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | 测试覆盖要求 | 测试: 写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 基本校验 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | 跳过 | — |

**步骤 2 技术栈扫描预期：**
- 依赖声明：next, react, @tanstack/react-query, next-intl, next-auth → 技术栈清单: Next.js + React + TanStack Query + next-intl + NextAuth
- 配置文件：.env 中 NEXT_PUBLIC_API_URL；next.config.mjs
- 源码模式：middleware.ts 含 NextResponse → Next.js middleware；layout.tsx → App Router
- 目录信号：app/ → Next.js App Router；messages/ → i18n

**步骤 2 覆盖分析预期：**

Tier 1：
- 组件模型（函数式组件 + hooks）→ 适用 → 必须保留
- any 禁止 → 适用 → 必须保留
- key 约束 → 适用 → 必须保留

Tier 2：
- 状态管理（TanStack Query）→ 有依赖 → 适用
- SSR/SSG boundary → Next.js → 适用
- i18n 规则 → next-intl → 适用
- 认证 → NextAuth → 适用
- 环境变量 → NEXT_PUBLIC_* → 适用

**步骤 4 自动推断：**
- 分层架构：app/services/ → 简单分层（写入）
- DI 方式：React Context + Props →自动 DI（不写入，前端默认模式）
- 异常处理：ErrorBoundary →全局拦截（写入）
- 同步/异步：Promise + async-await →全异步（不写入，前端天然异步）

**步骤 4 生成预期：**
- Server/Client Component 边界规则
- 环境变量规则（NEXT_PUBLIC_* 禁止存放密钥）
- TanStack Query 使用规范
- i18n 规则（翻译 key 嵌套结构，新文案同步所有语言文件）
- 认证规则（getServerSession Server 侧，useSession Client 侧）

**通过判定：**
- [ ] 检测到前端语言 + Next.js 框架
- [ ] 技术栈扫描识别 TanStack Query、next-intl、NextAuth
- [ ] 架构模式自动推断为简单分层 + 全局异常拦截
- [ ] 包含 Server/Client Component 边界规则
- [ ] 包含 i18n 翻译同步规则
- [ ] 包含 NEXT_PUBLIC_* 环境变量约束
- [ ] 全异步不生成反直觉 async 规则（前端天然异步）
- [ ] 不包含通用类库规则
- [ ] ≥ 150 行

---

## 场景 I：Go Gin + GORM + Redis

**目的：** 覆盖 Go 语言检测、Gin 框架、Go 检测信号（数据库、缓存、中间件）。

**输入项目：**
```
go.mod (gin, gorm, go-redis/v9, go.uber.org/zap)
目录结构: cmd/server/, internal/handler/, internal/service/, internal/repository/, internal/model/
config.yaml (数据库连接、Redis 地址)
.golangci.yml
go test（table-driven 测试模式）
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Go 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | Gin, GORM, Redis, Zap（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | golangci-lint（全选） | 确认 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | 最小测试 | 测试: 不写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 基本校验 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | 跳过 | — |

**步骤 2 技术栈扫描预期：**
- 依赖声明：gin, gorm, go-redis, zap → 技术栈清单: Gin + GORM + Redis + Zap
- 配置文件：config.yaml 含数据库连接串和 Redis 地址
- 源码模式：handler 中 gin.Context → Gin handler 模式；gorm.Model → GORM 模型
- 目录信号：cmd/server/, internal/ → Go 标准布局

**步骤 4 自动推断：**
- 分层架构：handler/service/repository →简单分层（写入）
- DI 方式：无 DI 框架→手动 DI（不写入）
- 异常处理：各层独立错误→各层独立异常（写入）
- 同步/异步：goroutine/channel →全异步（不写入，Go 惯例）

**步骤 4 生成预期：**
- Go 分层约束（handler 仅路由转发 / service 含业务逻辑 / repository 仅数据访问）
- 错误处理（各层独立：handler → HTTP 状态码 / service → 业务错误 / repository → 包装 sql.Err）
- 命名约定（handler XxHandler / service XxService / repository XxRepository）

**通过判定：**
- [ ] 检测到 Go 语言 + Gin 框架
- [ ] 技术栈扫描识别 GORM、Redis、Zap
- [ ] 架构模式自动推断为简单分层 + 各层独立异常
- [ ] 包含 handler/service/repository 分层约束
- [ ] 包含各层独立错误处理规则
- [ ] 不包含通用类库规则
- [ ] ≥ 150 行

---

## 场景 J：Rust Axum + tokio（全异步）

**目的：** 覆盖 Rust 语言检测、Axum 框架、架构模式自动推断（Rust tokio 模式）。

**输入项目：**
```
Cargo.toml (axum, tokio, sqlx, tower, serde, thiserror)
目录结构: src/handlers/, src/services/, src/models/, src/errors/
.sqlx/ 目录（离线查询元数据）
rustfmt.toml + clippy 配置
cargo test + proptest
```

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Rust 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | Axum, Tokio, SQLx, Tower, thiserror（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | rustfmt, clippy（全选） | 确认 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | TDD优先 | 测试: 写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 基本校验 | 安全: 不写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | 跳过 | — |

**步骤 2 技术栈扫描预期：**
- 依赖声明：axum, tokio, sqlx, tower, thiserror → 技术栈清单: Axum + Tokio + SQLx + Tower + thiserror
- 源码模式：async fn handler → Axum 异步路由；#[derive(thiserror)] → 自定义错误类型
- 目录信号：src/handlers/, src/services/ → 简单分层

**步骤 4 自动推断：**
- 分层架构：handlers/services/models →简单分层（写入）
- DI 方式：trait + State 共享→无 DI 框架（不写入）
- 异常处理：Result<T,E> + thiserror →各层独立异常（写入）
- 同步/异步：tokio::spawn + async fn →全异步（不写入，Rust 惯例）

**步骤 4 生成预期：**
- Rust 分层约束（handlers 路由 / services 业务逻辑 / models 数据结构）
- 错误处理（thiserror 自定义错误枚举 / handlers 通过 IntoResponse 映射 HTTP 状态码）
- TDD 流程（cargo test 先行、table-driven 测试模式）
- State 共享模式（Router::with_state()）

**通过判定：**
- [ ] 检测到 Rust 语言 + Axum 框架
- [ ] 技术栈扫描识别 tokio、sqlx、tower、thiserror
- [ ] 架构模式自动推断为简单分层 + 各层独立异常
- [ ] 包含 thiserror 错误枚举规则
- [ ] 包含 IntoResponse 映射规则
- [ ] 包含 TDD 流程规范
- [ ] 全异步不生成反直觉 async 规则（Rust 惯例）
- [ ] ≥ 150 行

---

## 场景 K：Java Spring Boot 多模块 + 拦截器事务 + 丰富技术栈

**目的：** 覆盖多模块 Maven 检测、4 类检测信号全覆盖（依赖声明/配置文件/源码模式/目录信号）、TransactionInterceptor 检测、Step 2 Tier 1 已覆盖和丢弃分支。

**输入项目：**
```
根 pom.xml: <packaging>pom</packaging>, <modules>[app, common, infra]</modules>
app/pom.xml: spring-boot-starter-web, spring-boot-starter-data-jpa, seata-spring-boot-starter
common/pom.xml: commons-lang3, mapstruct
infra/pom.xml: spring-boot-starter-data-redis, spring-cloud-starter-alibaba-nacos-config
app/src/main/resources/application.yml:
  spring.datasource.url: jdbc:mysql://localhost:3306/mydb
  spring.redis.host: localhost
  nacos.config.server-addr: localhost:8848
app/src/main/java/com/example/config/TransactionConfig.java:
  @Configuration @MapperScan("com.example.mapper")
  @Bean txAdvice(TransactionManager) → TransactionInterceptor + NameMatchTransactionAttributeSource
app/src/main/resources/db/migration/V1__init.sql (Flyway)
README.md: 含完整架构概览段落（分层描述、模块职责）
checkstyle.xml（覆盖 import 排序规则）
```

**步骤 1 预期：**
- 根 pom.xml 存在 → 推断 Java
- 检测到已有 CLAUDE.md → 更新模式

**步骤 2 技术栈扫描预期：**
- 依赖声明：app/pom.xml → spring-boot-starter-web, spring-boot-starter-data-jpa, seata-spring-boot-starter；infra/pom.xml → spring-boot-starter-data-redis, nacos-config；common/pom.xml → mapstruct
- 配置文件：application.yml → MySQL datasource URL、Redis host、Nacos address
- 源码模式：TransactionConfig.java → TransactionInterceptor + NameMatchTransactionAttributeSource → 拦截器式事务；@MapperScan → MyBatis
- 目录信号：db/migration/V*.sql → Flyway
- 多模块：根 pom.xml packaging=pom + modules → 遍历子模块 pom.xml → app 子模块为 Spring Boot 应用
- 技术栈清单: Spring Boot + MySQL + MyBatis + Seata + Redis + Nacos + Flyway + MapStruct

**步骤 2 覆盖分析预期：**

Tier 1 判定覆盖（5 条分支全覆盖）：
- 架构概览 → README.md 已覆盖 → **已覆盖: 提纯写入** ✅（分支 2.1.2）
- import 排序 → checkstyle 已覆盖 + 不反直觉 → **丢弃** ✅（分支 2.1.4）
- DI 注入规则 → Spring Boot → 适用 → **必须保留** ✅（分支 2.1.5）
- DTO 隔离 → 适用 → **必须保留** ✅
- 全局异常 → Spring Boot → 适用 → **必须保留** ✅

Tier 2：
- 拦截器式事务 → 检测到 TransactionInterceptor → 适用 → 等待 Tier 判定
- 分布式事务 → 检测到 Seata → 适用（Tier 3）
- 缓存 → 检测到 Redis → 适用
- 配置中心 → 检测到 Nacos → 适用
- 数据库迁移 → 检测到 Flyway → 适用
- 映射 → 检测到 MapStruct → 适用

**问答模拟：**
| 步骤 | 阶段 | 问题 | 回答 | 效果 |
|------|------|------|------|------|
| 步骤 1 | — | Q1 Java 确认？ | 确认 | — |
| 步骤 3 | 阶段 A | 框架与核心 | Spring Boot, MyBatis, Seata, Redis, Nacos, Flyway, MapStruct（全选） | 确认 |
| 步骤 3 | 阶段 A | 开发工具 | checkstyle（全选） | 确认 |
| 步骤 3 | 阶段 B | 优化推荐 | 跳过 | — |
| 步骤 3 | 阶段 C | C1 测试策略 | 测试覆盖要求 | 测试: 写入 |
| 步骤 3 | 阶段 C | C2 安全校验 | 严格边界校验 | 安全: 写入 |
| 步骤 3 | 阶段 C | C3 特有规则 | "事务拦截器新增方法需遵循 save*/get* 命名约定" | 写入 |

**步骤 4 自动推断：**
- 分层架构：controllers/models/services →MVC（写入）
- DI 方式：Spring Boot @Autowired →自动 DI（写入）
- 异常处理：@ControllerAdvice →全局拦截（写入）
- 同步/异步：非异步框架 + 全同步代码→非反直觉（不写入）

**步骤 4 生成预期：**
- 拦截器式事务规则（TransactionInterceptor + 命名约定 + 禁止混用 @Transactional）
- Seata 分布式事务规则（@GlobalTransactional 仅 Service 层入口）
- Redis 缓存规则（@Cacheable + key 含业务标识）
- Nacos 配置中心规则（@RefreshScope 动态配置）
- Flyway 迁移规则（禁止 ddl-auto=create/update）
- MapStruct 映射规则（componentModel="spring"）
- 架构概览 → 提纯 README.md 关键架构决策写入
- import 排序规则 → 不写入（checkstyle 覆盖）

**通过判定：**
- [ ] 多模块检测：识别根 POM 为 parent，app 子模块为 Spring Boot 应用
- [ ] 技术栈扫描覆盖 4 类信号：依赖声明（seata）、配置文件（MySQL URL）、源码（TransactionInterceptor）、目录（db/migration/）
- [ ] Step 2 Tier 1 已覆盖分支：架构概览标记为已覆盖，提纯写入
- [ ] Step 2 Tier 1 丢弃分支：import 排序标记为丢弃（checkstyle 覆盖）
- [ ] 架构模式自动推断为 MVC + 自动 DI + 全局异常拦截
- [ ] 包含拦截器式事务规则（TransactionInterceptor + 命名约定）
- [ ] 包含 Seata 分布式事务规则
- [ ] 包含 Flyway 迁移禁止 ddl-auto 规则
- [ ] 包含提纯的架构概要（从 README.md 提取，非逐条复制）
- [ ] 不包含 import 排序规则（checkstyle 已覆盖）
- [ ] ≥ 150 行

---

## 场景 L：Monorepo + 跨工具互操作

**目的：** 覆盖 Monorepo 嵌套 CLAUDE.md 策略、跨工具互操作（AGENTS.md + symlink）、pnpm workspace 检测、多包项目。

**输入项目：**
```
pnpm-workspace.yaml: packages: ['apps/*', 'packages/*']
apps/web/package.json (next, react, @tanstack/react-query)
apps/admin/package.json (vue, nuxt, pinia)
packages/shared/package.json (typescript, zod)
已有 AGENTS.md（旧版）
.github/workflows/ci.yml
```

**步骤 1：** 检测到已有 AGENTS.md → 记录互操作需求

**步骤 2 技术栈扫描预期：**
- 依赖声明：apps/web → Next.js + React + TanStack Query；apps/admin → Nuxt + Vue + Pinia；packages/shared → TypeScript + Zod
- 目录信号：pnpm-workspace.yaml → pnpm monorepo；apps/web/app/ → Next.js App Router
- 检测到多框架 Monorepo（React + Vue 共存）

**步骤 4 结构决策预期：**
- Monorepo 判断 → 建议嵌套 CLAUDE.md 策略（根 CLAUDE.md + apps/web/CLAUDE.md + apps/admin/CLAUDE.md）
- 互操作判断 → 已有 AGENTS.md → 建议以 AGENTS.md 为基础，CLAUDE.md symlink 到 AGENTS.md

**通过判定：**
- [ ] 技术栈扫描识别 Monorepo 结构（pnpm-workspace.yaml）
- [ ] 分别识别 apps/web（Next.js + React）和 apps/admin（Nuxt + Vue）
- [ ] 建议 Monorepo 嵌套 CLAUDE.md 策略
- [ ] 检测到 AGENTS.md → 建议互操作方案
- [ ] 根 CLAUDE.md 覆盖 Monorepo 级规则（workspace 命令、包间依赖）
- [ ] 子包 CLAUDE.md 覆盖各自框架规则

---

## 分支覆盖矩阵

所有分支点与对应测试场景的映射。每个分支至少被一个场景覆盖。

### 步骤 1：项目探测 + 语言识别 + 模式检测

| 分支 | 条件 | 覆盖场景 |
|------|------|---------|
| 1.1 | 不存在 CLAUDE.md → 创建模式 | A, E, H, I, J |
| 1.2.1 | 已存在 CLAUDE.md → 全量重写 | F, G |
| 1.2.2 | 已存在 CLAUDE.md → 增量更新 | C |
| 1.3 | 跨工具互操作检测 | L |
| 1.4 | 语言检测: Python | A, B, E |
| 1.4 | 语言检测: Java | G, K |
| 1.4 | 语言检测: 前端 | H, L |
| 1.4 | 语言检测: Go | I |
| 1.4 | 语言检测: Rust | J |
| 1.5.1 | Q1 确认语言 | A, B, E, G, H, I, J, K |
| 1.5.2 | Q1 纠正语言 | F |
| 1.6 | reference 文件存在 → 技术栈扫描 | A, B, E, G, H, I, J, K |
| 1.7 | reference 文件不存在 → 跳过扫描 | F |
| 1.8 | 多模块检测 | K, L |

### 步骤 2：项目信息收集 + 技术栈扫描

| 分支 | 条件 | 覆盖场景 |
|------|------|---------|
| 2.1.1 | Tier 1: 不适用（框架/工具未检测到） | A (DI rule) |
| 2.1.2 | Tier 1: 已覆盖（文档已覆盖，提纯写入） | K (架构概览 → README) |
| 2.1.3 | Tier 1: 必须强调（工具覆盖 + 反直觉） | A (async 规则 + FastAPI 全同步) |
| 2.1.4 | Tier 1: 丢弃（工具覆盖 + 不反直觉） | K (import 排序 → checkstyle) |
| 2.1.5 | Tier 1: 必须保留（无覆盖） | A (Final rule), B (DI rule) |
| 2.2 | Tier 2: 候选推荐池非空 | B (日志规范), K (缓存/配置中心等) |
| 2.3 | 依赖声明类信号 | K (seata-spring-boot-starter) |
| 2.4 | 配置文件类信号 | K (application.yml MySQL URL) |
| 2.5 | 源码模式类信号 | K (TransactionInterceptor) |
| 2.6 | 目录信号类 | K (db/migration/), H (messages/) |

### 步骤 3：交互式确认

| 分支 | 条件 | 覆盖场景 |
|------|------|---------|
| 3.1.1 | 阶段 A: 技术栈事实确认（multiSelect） | A, B, E, G, H, I, J, K |
| 3.1.2 | 阶段 A: 内部类库勾选触发 Explore Agent | B, E, K |
| 3.2.1 | 阶段 B: 优化推荐采纳（multiSelect） | B (统一异常) |
| 3.2.2 | 阶段 B: 跳过（候选池为空或无采纳） | A, E, F, G, H, I, J, K |
| 3.3.1 | 阶段 C: C1 测试策略 - 最小测试 | A, F, I |
| 3.3.2 | 阶段 C: C1 测试策略 - 覆盖要求 | B, E, H, K |
| 3.3.3 | 阶段 C: C1 测试策略 - TDD优先 | G, J |
| 3.3.4 | 阶段 C: C1 测试策略 - 无特殊要求 | F |
| 3.3.5 | 阶段 C: C2 安全校验 - 严格边界 | B, K |
| 3.3.6 | 阶段 C: C2 安全校验 - 基本校验 | A, G, H, I |
| 3.3.7 | 阶段 C: C2 安全校验 - 无特殊要求 | E, F, J |
| 3.3.8 | 阶段 C: C3 特有规则 - 有输入 | B, G, K |
| 3.3.9 | 阶段 C: C3 特有规则 - 跳过 | A, E, F, H, I, J |

### 步骤 4：生成 CLAUDE.md

| 分支 | 条件 | 覆盖场景 |
|------|------|---------|
| 4.1 | 架构模式自动推断: DDD | B |
| 4.2 | 架构模式自动推断: MVC | E, K |
| 4.3 | 架构模式自动推断: 简单分层 | G, H, I, J |
| 4.4 | 架构模式自动推断: 无架构 | A, F |
| 4.5 | DI 方式自动推断: 自动 DI | B, H, K |
| 4.6 | DI 方式自动推断: 手动 DI | G, I |
| 4.7 | DI 方式自动推断: 无 DI | A, F, J |
| 4.8 | 异常处理自动推断: 全局拦截 | B, H, K |
| 4.9 | 异常处理自动推断: 各层独立 | G, I, J |
| 4.10 | 异常处理自动推断: 简单try-catch | A, F |
| 4.11 | 同步/异步自动推断: 反直觉（异步框架 + 同步代码） | A, B, E, K |
| 4.12 | 同步/异步自动推断: 不写入（前端/Go/Rust 天然异步） | H, I, J |
| 4.13 | 4a 全量重写 | A, B, E, F, G, H, I, J, K |
| 4.14 | 4b 增量更新（差异建议表） | C |
| 4.15 | Tier 1 写入 | A, B, H, I, J, K |
| 4.16 | Tier 2 阶段 A/B/C 激活写入 | B, E, G, H, K |
| 4.17 | Tier 2 通用池（< 120 行） | B (日志规范) |
| 4.18 | Tier 3 C3 激活 | B, G, K |

### 步骤 5：迭代优化（可选）

| 分支 | 条件 | 覆盖场景 |
|------|------|---------|
| 5.1 | 完成，先测试 | All |
| 5.2 | 有反馈，迭代 | — （需实际使用触发） |
