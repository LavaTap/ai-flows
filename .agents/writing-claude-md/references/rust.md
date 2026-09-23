# Rust 项目语言参考资料

> 适用于：Rust 2021+ 项目，覆盖 Actix-web / Axum / Tokio 及标准库项目

## 命令表

### 工具链命令

| 操作 | 命令 |
|------|------|
| 编译 | `cargo build` |
| 编译（release） | `cargo build --release` |
| 测试 | `cargo test` |
| 测试（详细） | `cargo test -- --nocapture` |
| 测试（单线程） | `cargo test -- --test-threads=1` |
| Lint | `cargo clippy -- -D warnings` |
| 格式化 | `cargo fmt` |
| 格式化检查 | `cargo fmt -- --check` |
| 依赖审计 | `cargo audit` |
| 依赖许可检查 | `cargo deny check` |
| 文档生成 | `cargo doc --open` |
| 全部检查 | `cargo fmt --check && cargo clippy -- -D warnings && cargo test` |

### Workspace 检测

| 信号 | 含义 | 检测方式 |
|------|------|---------|
| 根 `Cargo.toml` 含 `[workspace]` | Cargo workspace（多 crate） | 读取 Cargo.toml |
| 根 `Cargo.toml` 含 `members = [...]` | workspace 成员列表 | 读取 `workspace.members` |
| 多个子目录各有 `Cargo.toml` | 多 crate 项目 | `find . -maxdepth 3 -name 'Cargo.toml'` |
| `Cargo.toml` 含 `[workspace.dependencies]` | workspace 共享依赖版本 | workspace 级依赖统一管理 |

## 工具链覆盖清单

| 工具 | 覆盖的规则 |
|------|-----------|
| **rustfmt** | 代码格式：缩进（4 空格）、大括号、行宽 100、import 分组 |
| **clippy** | 综合 Lint：常见错误、性能反模式、惯用法建议、复杂度警告 |
| **cargo test** | 单元测试、集成测试、文档测试 |
| **cargo audit** | 依赖安全漏洞扫描 |
| **cargo deny** | 依赖许可证合规、重复依赖、废弃 crate |
| **rustc 类型系统** | 所有权/借用规则、生命周期、trait bound（编译器强制） |

## 优先级分层

生成 CLAUDE.md 时按以下优先级填充，空间不足时优先保证 Tier 1。

### Tier 1：核心规则（几乎所有项目）
- unwrap 策略：业务代码禁止 unwrap()/expect()，使用 ? 或 ok_or
- unsafe 策略：禁止 unsafe（除非有 safety 注释）
- panic 策略：库代码禁止 panic，仅返回 Result

### Tier 2：推荐规则（取决于项目风格）
- Error 枚举模式：thiserror crate 定义错误枚举
- clone 策略：避免不必要的 clone()，优先借用
- 字符串：&str 用于借用，String 用于拥有所有权
- 异步运行时选择（Tokio / async-std）

### Tier 3：边缘场景（特定条件才需要）
- Send 约束与 !Send 类型跨 await point
- 取消安全性考虑
- 错误链 #[source] / #[from] 属性
- 属性测试 proptest
- 基准测试 criterion.rs

## 检测信号

### 数据库

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| PostgreSQL | Cargo.toml / Rust 源码 | `sqlx` + `postgres` feature / `diesel` + `postgres` feature / `tokio-postgres` |
| MySQL | Cargo.toml / Rust 源码 | `sqlx` + `mysql` feature / `diesel` + `mysql` feature |
| SQLite | Cargo.toml / Rust 源码 | `sqlx` + `sqlite` feature / `diesel` + `sqlite` feature / `rusqlite` |
| MongoDB | Cargo.toml / Rust 源码 | `mongodb` / `bson` |
| Redis | Cargo.toml / Rust 源码 | `redis` / `deadpool-redis` |
| Elasticsearch | Cargo.toml / Rust 源码 | `elasticsearch` / `rs-es` |
| 连接池 | Cargo.toml / Rust 源码 | `deadpool` / `bb8` / `r2d2` / `sqlx::Pool` |
| ORM 框架 | Cargo.toml / Rust 源码 | `sea-orm` / `diesel` / `sqlx`（query builder） |

### 事务/数据库配置

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| sqlx 事务 | Rust 源码 | `tx.begin()` / `Transaction` / `sqlx::Transaction` / `query!.as_execute()` |
| diesel 事务 | Rust 源码 | `conn.transaction(` / `diesel::connection::TransactionManager` |
| sea-orm 事务 | Rust 源码 | `txn.begin()` / `TransactionTrait` / `sea_orm::Transaction` |

### 认证/鉴权

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| JWT (jsonwebtoken) | Cargo.toml / Rust 源码 | `jsonwebtoken` / `encode` / `decode` / `Validation` |
| Axum auth extractor | Rust 源码 | 自定义 `FromRequestParts` 实现 / `AuthUser` / auth middleware layer |
| Actix auth extractor | Rust 源码 | `FromRequest` trait 实现 / `Identity` / auth middleware |
| OAuth2 | Cargo.toml / Rust 源码 | `oauth2` crate / `openidconnect` crate |

### 数据库迁移

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| sqlx-cli | `migrations/` 目录 | `sqlx migrate add` / `.sql` 文件 |
| diesel-cli | `migrations/` 目录 | `diesel migration generate` / `up.sql` / `down.sql` |
| sea-orm-cli | `migration/` 目录 | `sea_orm_migration` / `MigrationTrait` |

### HTTP Client / 服务间调用

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| reqwest | Cargo.toml / Rust 源码 | `reqwest` / `Client::new()` / `.get()` / `.json()` |
| surf | Cargo.toml / Rust 源码 | `surf` / `surf::get` / `surf::post` |
| tonic (gRPC 客户端) | Cargo.toml / Rust 源码 | `tonic` / `tonic::transport::Channel` / proto stub |
| prost (protobuf) | Cargo.toml / proto 文件 | `prost` / `.proto` 文件 / `prost-build` |
| hyper (底层) | Cargo.toml / Rust 源码 | `hyper` / `hyper::Client` / `hyper::Request` |

### 定时任务 / 后台作业

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| tokio-cron-scheduler | Cargo.toml / Rust 源码 | `tokio-cron-scheduler` / `Job::new_async` / `JobScheduler` |
| clokwerk | Cargo.toml / Rust 源码 | `clokwerk` / `Scheduler::new` / `.every` |
| apalis | Cargo.toml / Rust 源码 | `apalis` / `apalis::prelude` / 后台作业框架 |
| tokio::spawn 循环 | Rust 源码 | `tokio::spawn` + `tokio::time::interval` 循环模式 |

### 对象存储 / 文件

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| AWS S3 | Cargo.toml / Rust 源码 | `aws-sdk-s3` / `rust-s3` / `S3Client` |
| MinIO | Cargo.toml / Rust 源码 | `rust-s3` / `minio` / `Bucket` |
| 阿里云 OSS | Cargo.toml / Rust 源码 | `ali-oss` / `oss-rsdk` |

### 配置管理（集中式）

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| config crate | Cargo.toml / Rust 源码 | `config` / `Config::builder` / `.set_default` |
| dotenv | Cargo.toml / Rust 源码 | `dotenv` / `dotenvy` / `.env` 文件 |
| envy | Cargo.toml / Rust 源码 | `envy` / `from_env` |
| clap | Cargo.toml / Rust 源码 | `clap` / `#[derive(Parser)]` / CLI 参数配置 |

### 限流 / 熔断 / 弹性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| tower retry / limit | Cargo.toml / Rust 源码 | `tower::limit::RateLimit` / `tower::retry::Policy` / `ServiceBuilder` |
| failsafe | Cargo.toml / Rust 源码 | `failsafe` / `CircuitBreaker` |

### WebSocket / SSE

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| tokio-tungstenite | Cargo.toml / Rust 源码 | `tokio-tungstenite` / `accept_async` / `Message` |
| axum WebSocket | Rust 源码 | `axum::extract::ws` / `WebSocketUpgrade` / `ws.on_upgrade` |
| SSE | Rust 源码 | `axum::response::sse` / `Sse` / `text/event-stream` |

### 模板引擎

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Tera | Cargo.toml / Rust 源码 | `tera` / `Tera::new` / Jinja2 风格 |
| Askama | Cargo.toml / Rust 源码 | `askama` / `#[derive(Template)]` / 编译时模板 |
| Handlebars | Cargo.toml / Rust 源码 | `handlebars` / `Handlebars::new` |
| minijinja | Cargo.toml / Rust 源码 | `minijinja` / `Environment::new` |

### 测试基础设施

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Testcontainers | Cargo.toml / test 源码 | `testcontainers` / `DockerRunner` / `images::generic` |
| wiremock-rs | Cargo.toml / test 源码 | `wiremock` / `MockServer::start` / `Mock::given` |
| mockall | Cargo.toml / test 源码 | `mockall` / `#[automock]` / `mock!` |
| tokio::test | Rust 源码 | `#[tokio::test]` / 异步测试 |
| proptest | Cargo.toml / test 源码 | `proptest` / 属性测试 |
| criterion | Cargo.toml / bench 源码 | `criterion` / `BenchmarkGroup` / 性能基准测试 |

### 日志/可观测性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| tracing 配置 | Rust 源码 / main | `tracing_subscriber::init()` / `setup_tracing` / `init_subscriber` |
| tracing spans | Rust 源码 | `#[instrument]` / `tracing::info!` / `tracing::span!` |
| OpenTelemetry | Cargo.toml / Rust 源码 | `opentelemetry` / `tracing-opentelemetry` / `opentelemetry-otlp` |

### 消息队列

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| lapin (RabbitMQ) | Cargo.toml / Rust 源码 | `lapin` / `Channel.basic_consume` / `BasicProperties` |
| rdkafka | Cargo.toml / Rust 源码 | `rdkafka` / `BaseConsumer` / `FutureProducer` |
| NATS | Cargo.toml / Rust 源码 | `async-nats` / `ConnectOptions` / `Subscriber` |

### 缓存

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Redis | Cargo.toml / Rust 源码 | `redis` / `deadpool-redis` / `redis::Connection` |
| moka | Cargo.toml / Rust 源码 | `moka::sync::Cache` / `moka::future::Cache` |

### 框架/工具

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Tower middleware 层 | Rust 源码 | `.layer(` / `ServiceBuilder` / `tower::ServiceBuilder` |
| Axum State | Rust 源码 | `Router::with_state(` / `State<AppState>` |
| Actix State | Rust 源码 | `web::Data<` / `App::app_data(` |
| Feature flags | Cargo.toml | `[features]` 段 / `#[cfg(feature =` |

## Rust 特有约束（候选规则池）

### 架构类

- **目录结构**：`src/bin/`（入口）/ `src/lib.rs`（库根）/ `src/<module>/`（模块）
- **Error 类型**：定义项目级 `Error` 枚举，实现 `std::error::Error` + `From<具体错误>`
- **Result 传播**：使用 `?` 操作符，禁止 `unwrap()` / `expect()` 在业务代码中（仅测试允许）
- **trait 设计**：小而聚焦，避免大 trait，使用 trait bound 约束泛型

### 代码规范类

- **unwrap 策略**：业务代码禁止 `unwrap()`/`expect()`，使用 `?` 或 `ok_or`/`ok_or_else`
- **clone 策略**：避免不必要的 `clone()`，优先借用和引用。如果必须 clone，说明原因
- **unsafe 策略**：禁止 `unsafe`（除非有明确的 safety 注释说明为何安全），隔离在 `unsafe fn` 中
- **panic 策略**：库代码禁止 panic，仅允许返回 Result。`assert!` 仅在测试中使用
- **字符串**：`&str` 用于借用，`String` 用于拥有所有权。避免不必要的 `to_string()`

### 异步类

- **运行时选择**：明确 Tokio / async-std（通常 Tokio），不混用
- **async 函数**：标注 `#[tokio::main]` 或 `#[tokio::test]`
- **Send 约束**：异步任务需满足 `Send`，注意 `!Send` 类型跨 await point
- **取消安全**：异步操作考虑取消安全性（如数据库事务）

### 错误处理类

- **Error 枚举模式**：`thiserror` crate 定义错误枚举
- **错误链**：`#[source]` 属性保留错误链，`#[from]` 自动转换
- **错误上下文**：`anyhow::Context` 或 `eyre` 添加上下文信息
- **禁止 Box<dyn Error>**：使用具体错误类型或 `anyhow::Error`
- **各层独立错误处理**（Tier 2，Q4=各层独立时激活）
  - Data 层：用 `thiserror` 定义数据层错误枚举（如 `DataError::Io`、`DataError::Query`）
  - Service 层：定义业务错误枚举，用 `From<DataError>` 转换底层错误
  - API 层：将业务错误映射为 HTTP 响应（如 `impl IntoResponse for AppError`）
  - ✅ 每层错误类型独立，通过 `From` trait 自动转换
  - ❌ 禁止 Data 层直接返回 HTTP 响应类型

## 框架特定规则

### Axum

| 规则 | 说明 |
|------|------|
| Handler | `async fn handler(Extractors) -> impl IntoResponse` |
| State | `State<AppState>` 共享状态，通过 `Router::with_state()` 注入 |
| Extractor | `Json<T>`, `Path<T>`, `Query<T>` 请求解析 |
| 错误处理 | 自定义 `IntoResponse` 实现统一错误响应 |
| 中间件 | Tower middleware `.layer()` 挂载，层叠顺序有语义（从外到内执行） |
| 路由 | `Router::new().route("/path", post(handler))` |
| 事务 | Service 层管理事务边界，Handler 禁止持有 `Transaction` 对象 |
| 认证 | auth 作为 Tower layer 或自定义 `FromRequestParts` extractor，新接口默认受保护 |
| CORS | `tower-http::cors::CorsLayer` 集中配置，禁止 Handler 手动写 CORS header |
| 日志 | 检测到 tracing 时：`#[instrument]` 标注 Service 方法，`tracing::info!` 记录关键操作 |
| 迁移 | 检测到 sqlx-cli/diesel-cli 时：新增表/字段走迁移脚本，禁止手动 DDL |
| HTTP Client | 封装在独立的 `client` 模块，Handler 禁止直接发起 HTTP 调用 |
| 定时任务 | 检测到 tokio-cron-scheduler 时：任务定义在 `jobs/` 模块，通过 `on_startup` 注册 |
| 对象存储 | 文件操作通过统一的 StorageService 封装，禁止 Handler 直接使用 S3 Client |
| 配置 | 检测到 config crate 时：配置结构体用 `Deserialize`，新配置项同步更新 struct |
| WebSocket | `WebSocketUpgrade` handler 仅做连接升级，消息处理在 Service 层 |
| SSE | `Sse(stream)` 用于实时推送，stream 在 Service 层生成 |

### Actix-web

| 规则 | 说明 |
|------|------|
| Handler | `async fn handler(HttpRequest, Json<T>) -> HttpResponse` |
| State | `web::Data<AppState>` 共享状态 |
| Extractor | `web::Json<T>`, `web::Path<T>`, `web::Query<T>` |
| 错误处理 | 自定义 `ResponseError` trait 实现 |
| 中间件 | `actix_web::middleware` + 自定义 `Transform` |
| 路由 | `App::new().service(web::resource("/path").route(post(handler)))` |
| 认证 | auth middleware 通过 `app.wrap()` 挂载，或自定义 `FromRequest` extractor |
| HTTP Client | 封装在独立模块，Handler 禁止直接发起 HTTP 调用 |
| 定时任务 | 通过 `actix_rt::spawn` + `tokio::time::interval` 在 `HttpServer::workers` 中注册 |
| WebSocket | `actix-ws` / `HttpRequest::upgrade()` handler 仅做连接升级 |

### Tokio

| 规则 | 说明 |
|------|------|
| 运行时 | `#[tokio::main]` 入口，明确 `flavor = "multi_thread"` 或 `current_thread` |
| 任务 | `tokio::spawn` 要求 `Send + 'static` |
| 通道 | `tokio::sync::mpsc` 有界通道优先 |
| 同步 | `tokio::sync::Mutex`（跨 await）/ `std::sync::Mutex`（不跨 await） |

## 测试约定

- 框架：内置 `#[test]` + `tokio::test`
- 单元测试：`#[cfg(test)] mod tests` 放在同一文件
- 集成测试：`tests/` 目录下独立文件
- 命名：`test_<场景>_<预期>`
- 属性测试：`proptest` crate 用于边界条件覆盖
- Mock：`mockall` crate，仅 mock 外部依赖
- 基准测试：`#[bench]`（需 `#![feature(test)]`）或 criterion.rs
- **TDD 流程**（Tier 2，Q7=TDD优先时激活）
  - 红灯→绿灯→重构：先写 `#[test]` 失败测试 → 最小实现通过 → 重构
  - 使用 `cargo watch -x test` 自动运行测试
  - ✅ 结合 `proptest` 做属性测试，覆盖边界条件
  - ❌ 禁止先写实现再补测试
- **测试覆盖要求**（Tier 2，Q7=覆盖要求时激活）
  - 配置 `cargo-tarpaulin` 或 `cargo-llvm-cov` 生成覆盖率报告
  - 设置覆盖阈值（如 ≥ 80%）
  - ✅ CI 中覆盖率检查作为门禁
  - ❌ 禁止为凑覆盖率写无意义测试
- **安全边界校验**（Tier 2，Q8=严格边界校验时激活）
  - 路径校验：使用 `std::path::Path::canonicalize()` + 前缀检查防止路径遍历
  - ID 校验：外部 API 使用 UUID（`uuid` crate），禁止暴露自增 ID
  - 输入校验：使用 `validator` crate 对 struct 字段做声明式校验（`#[validate]`）
  - API 枚举防护：统一错误响应，不泄露内部错误类型差异
  - ✅ Axum extractor（`Path<T>`、`Json<T>`）自动校验并拒绝无效输入
  - ❌ 禁止将用户输入直接用于文件系统操作或数据库查询拼接

## 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 类型/结构体 | PascalCase | `SkillRouter` |
| trait | PascalCase | `Matcher`, `SkillLoader` |
| 枚举变体 | PascalCase | `MatchResult::Found` |
| 函数/方法 | snake_case | `match_skills()` |
| 变量 | snake_case | `matched_skills` |
| 常量 | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |
| 模块 | snake_case | `skill_router` |
| 文件 | snake_case | `skill_router.rs` |
| Cargo feature | kebab-case | `semantic-match` |
| 生命周期 | 短小写（`'a`, `'ctx`） | `fn parse<'a>(&'a str)` |
| Error 变体 | PascalCase | `NotFound`, `InvalidInput` |
