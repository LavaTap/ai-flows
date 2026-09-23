# Go 项目语言参考资料

> 适用于：Go 1.21+ 项目，覆盖 Gin / Echo / Fiber 及标准库项目

## 命令表

### 工具链命令

| 操作 | 命令 |
|------|------|
| 编译 | `go build ./...` |
| 测试 | `go test ./...` |
| 测试（详细） | `go test -v ./...` |
| 测试覆盖率 | `go test -cover ./...` |
| 竞态检测 | `go test -race ./...` |
| Lint | `golangci-lint run` |
| 格式化 | `gofmt -w .` 或 `goimports -w .` |
| 依赖整理 | `go mod tidy` |
| 静态分析 | `go vet ./...` |
| 安全检查 | `gosec ./...` |

### 多模块项目检测

| 信号 | 含义 | 检测方式 |
|------|------|---------|
| `go.work` 文件 | Go workspace（多模块） | 读取 go.work 中 `use` 指令 |
| 多个 `go.mod` 文件 | 多模块仓库 | `find . -name 'go.mod' \| grep -v vendor` |
| `go.work.sum` | workspace 依赖校验 | 确认 go.work 存在 |

## 工具链覆盖清单

| 工具 | 覆盖的规则 |
|------|-----------|
| **gofmt / goimports** | 代码格式：缩进（tab）、大括号、import 排序分组 |
| **go vet** | 常见错误：未使用变量、错误格式化字符串、死锁 |
| **golangci-lint** | 综合 Lint：errcheck、staticcheck、gosimple、ineffassign、govet |
| **staticcheck** | 高级静态分析：废弃 API、性能反模式 |
| **gosec** | 安全扫描：硬编码凭证、SQL 注入、弱加密 |
| **go test -race** | 竞态条件检测 |

## 优先级分层

生成 CLAUDE.md 时按以下优先级填充，空间不足时优先保证 Tier 1。

### Tier 1：核心规则（几乎所有项目）
- 错误处理：始终包装错误上下文 fmt.Errorf("context: %w", err)
- context 传递：所有跨函数调用传 context.Context 作为第一个参数
- 禁止 panic：业务代码禁止 panic

### Tier 2：推荐规则（取决于项目风格）
- 目录结构：cmd/ / internal/ / pkg/ / api/ 约定
- 依赖方向：cmd/ → internal/ → pkg/，禁止反向
- 接口设计：消费者定义接口，小且聚焦
- goroutine 生命周期：每个 goroutine 必须有明确退出机制

### Tier 3：边缘场景（特定条件才需要）
- 通道方向标注
- sync vs channel 选择策略
- table-driven tests 模式
- 竞态检测 -race

## 检测信号

### 数据库

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| PostgreSQL | go.mod / Go 源码 | `pgx` / `lib/pq` / `jackc/pgx` / `sql.Open("pgx` / `postgres://` |
| MySQL | go.mod / Go 源码 | `go-sql-driver/mysql` / `sql.Open("mysql` / `mysql://` |
| SQLite | go.mod / Go 源码 | `mattn/go-sqlite3` / `modernc.org/sqlite` / `sql.Open("sqlite` |
| MongoDB | go.mod / Go 源码 | `mongo-driver` / `mongo.Connect` / `bson.M` |
| CockroachDB | go.mod / Go 源码 | `cockroach-go` / `cockroachdb://` |
| Redis | go.mod / Go 源码 | `go-redis` / `redis.NewClient` / `redis.UniversalClient` |
| Elasticsearch | go.mod / Go 源码 | `olivere/elastic` / `go-elasticsearch` |
| 多数据库 | Go 源码 | 多个 `*sql.DB` 实例 / 读写分离 / `db.Get(readDB)` vs `db.Get(writeDB)` |
| 连接池 | Go 源码 | `db.SetMaxOpenConns` / `db.SetMaxIdleConns` / `db.SetConnMaxLifetime` |
| ORM 框架 | go.mod / Go 源码 | `gorm.io/gorm` / `entgo.io/ent` / `upper/db` / `xo` |
| 查询构建器 | go.mod / Go 源码 | `squirrel` / `goqu` / `bob` |

### 事务/数据库配置

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| sqlx 事务 | Go 源码 | `db.BeginTx` / `tx.Commit` / `tx.Rollback` / `sqlx` |
| GORM 事务 | Go 源码 | `db.Transaction(` / `db.Begin()` / `Session(&gorm.Session{})` |
| ent 事务 | Go 源码 | `client.Tx()` / `WithTx(` / `ent` |

### 认证/鉴权

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| JWT middleware | Go 源码 | `jwt.Parse` / `jwtmiddleware` / `jwt-go` /自定义 auth middleware |
| Gin auth middleware | Go 源码 | `router.Use(authMiddleware)` / `c.Set("user"` |
| Echo auth middleware | Go 源码 | `e.Use(middleware.JWT(`) /自定义 `echo.MiddlewareFunc` |
| gRPC auth | Go 源码 | `grpc.Authenticator` / credentials / `grpc.PerRPCCredentials` |

### 数据库迁移

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| golang-migrate | `migrations/` 目录 / Go 源码 | `migrate.New` / `.up.sql` / `.down.sql` |
| goose | `migrations/` 目录 / Go 源码 | `goose.Up` / `goose.Create` / `.sql` 文件 |
| GORM AutoMigrate | Go 源码 | `db.AutoMigrate(` |
| atlas | `atlas.hcl` / 目录 | `atlas` / `schema.Apply` |

### HTTP Client / 服务间调用

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| net/http (标准库) | Go 源码 | `http.Get` / `http.Post` / `http.Client{Timeout:}` |
| resty | go.mod / Go 源码 | `go-resty` / `resty.New` / `r.SetTimeout` |
| req | go.mod / Go 源码 | `imroc/req` / `req.New` / 自定义 client |
| fasthttp | go.mod / Go 源码 | `fasthttp` / `fasthttp.Client` / `fasthttp.Request` |
| gRPC 客户端 | go.mod / Go 源码 | `grpc.Dial` / `grpc.WithInsecure` / proto stub |
| protobuf | go.mod / proto 文件 | `google.golang.org/protobuf` / `.proto` 文件 |

### 定时任务 / 后台作业

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| robfig/cron | go.mod / Go 源码 | `robfig/cron` / `c.AddFunc` / `c.Start` |
| asynq | go.mod / Go 源码 | `hibiken/asynq` / `asynq.NewClient` / `asynq.NewScheduler` |
| gocron | go.mod / Go 源码 | `gocron` / `s.Every` / `s.Do` |
| time.Ticker / time.AfterFunc | Go 源码 | `time.NewTicker` / `time.AfterFunc` |

### 对象存储 / 文件

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| AWS S3 | go.mod / Go 源码 | `aws-sdk-go` / `aws-sdk-go-v2` / `s3manager.NewUploader` |
| MinIO | go.mod / Go 源码 | `minio-go` / `minio.New` / `PutObject` |
| 阿里云 OSS | go.mod / Go 源码 | `aliyun-oss-go-sdk` / `oss.New` / `bucket.PutObject` |

### 配置中心（集中式）

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Viper | go.mod / Go 源码 | `viper` / `viper.SetConfigName` / `viper.WatchConfig` |
| Consul | go.mod / Go 源码 | `hashicorp/consul/api` / `consul.KV()` |
| etcd | go.mod / Go 源码 | `go.etcd.io/etcd/client` / `clientv3` |
| Nacos | go.mod / Go 源码 | `nacos-sdk-go` / `config.GetConfig` |

### 限流 / 熔断 / 弹性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| tollbooth | go.mod / Go 源码 | `tollbooth` / `tollbooth.LimitHandler` |
| circuitbreaker | go.mod / Go 源码 | `circuitbreaker` / `cb.Execute` / `sony/gobreaker` |
| resilience4go | go.mod / Go 源码 | `resiliencego` / `circuitbreaker` / `ratelimiter` |
| retry | go.mod / Go 源码 | `avast/retry-go` / `retry.Do` / `sette/retry` |

### WebSocket / SSE

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| gorilla/websocket | go.mod / Go 源码 | `gorilla/websocket` / `Upgrader` / `conn.ReadMessage` |
| nhooyr.io/websocket | go.mod / Go 源码 | `nhooyr.io/websocket` / `websocket.Accept` |
| SSE | Go 源码 | `Flusher` / `text/event-stream` / `fmt.Fprintf(w, "data: ` |

### 模板引擎

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| html/template | Go 标准库 | `template.ParseFiles` / `tmpl.Execute` / `template.HTML` |
| text/template | Go 标准库 | `text/template` / `template.New` |
| Pongo2 | go.mod / Go 源码 | `flosch/pongo2` / Django 风格模板 |

### 测试基础设施

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Testcontainers | go.mod / test 源码 | `testcontainers-go` / `testcontainers.GenericContainer` |
| gomock | go.mod / test 源码 | `gomock` / `gomock.Controller` / `mockgen` |
| testify | go.mod / test 源码 | `testify` / `assert.Equal` / `suite.Suite` |
| gock | go.mod / test 源码 | `h2non/gock` / HTTP mock / `gock.New` |
| httptest | Go 标准库 | `httptest.NewServer` / `httptest.NewRecorder` |

### 日志/可观测性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| zap | go.mod / Go 源码 | `zap.NewProduction` / `zap.L()` / `zap.S()` |
| slog | Go 源码 | `slog.Info` / `slog.With` / `slog.SetDefault` |
| logrus | go.mod / Go 源码 | `logrus.New` / `logrus.WithFields` |
| OpenTelemetry | go.mod / Go 源码 | `otel` / `otelhttp` / `otelsql` / `trace.SpanFromContext` |

### 消息队列

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| NATS | go.mod / Go 源码 | `nats.Connect` / `nc.Subscribe` / `nc.Publish` |
| RabbitMQ | go.mod / Go 源码 | `amqp.Dial` / `channel.Consume` / `amqp091-go` |
| Kafka (confluent/sarama) | go.mod / Go 源码 | `kafka.Consumer` / `kafka.Producer` / `sarama.NewConsumer` |
| Redis Streams | go.mod / Go 源码 | `XRead` / `XAdd` / `go-redis` |

### 缓存

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Redis | go.mod / Go 源码 | `go-redis` / `redis.NewClient` / `redis.UniversalClient` |
| go-cache / bigcache | go.mod / Go 源码 | `cache.New` / `bigcache.NewBigCache` |
| Caffeine-style (ristretto) | go.mod / Go 源码 | `ristretto.NewCache` |

### 验证

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| validator/v10 | go.mod / Go 源码 | `validate.Var` / `validate.Struct` / `binding:` tag |
| Gin binding | Go 源码 | `ShouldBindJSON` / `binding:` tag |

### CORS

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Gin CORS | Go 源码 | `cors.Default()` / `cors.Config{}` middleware |
| Echo CORS | Go 源码 | `e.Use(middleware.CORSWithConfig` |
| 手动 CORS | Go 源码 | `w.Header().Set("Access-Control-` |

### 框架/DI

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Gin 中间件链 | Go 源码 | `router.Use(` / `group.Use(` / 自定义 `gin.HandlerFunc` |
| Echo 中间件 | Go 源码 | `e.Use(` / `e.Pre(` / 自定义 `echo.MiddlewareFunc` |
| gRPC 拦截器 | Go 源码 | `grpc.UnaryInterceptor` / `grpc.StreamInterceptor` / `grpc.ChainUnaryInterceptor` |
| gRPC 服务注册 | Go 源码 / proto 文件 | `pb.Register*Server` / `.proto` 文件 |
| Wire DI | Go 源码 | `wire.Build` / `wire.NewSet` / `wire.go` |

## Go 特有约束（候选规则池）

### 架构类

- **目录结构**：`cmd/`（入口）/ `internal/`（私有包）/ `pkg/`（公共库）/ `api/`（协议定义）
- **依赖方向**：`cmd/` → `internal/` → `pkg/`，禁止反向
- **接口定义**：消费者定义接口（return interfaces, accept structs），而非生产者
- **接口隐式实现**：无需 `implements` 声明，接口应小且聚焦（单一方法接口优先）

### 代码规范类

- **错误处理**：`if err != nil { return fmt.Errorf("context: %w", err) }` 始终包装错误上下文
- **各层独立错误处理**（Tier 2，Q4=各层独立时激活）
  - Repository 层：包装底层错误 `fmt.Errorf("repository: %w", err)`，保留错误链
  - Service 层：用 `errors.Is`/`errors.As` 判断错误类型，返回业务级错误
  - Handler 层：将业务错误映射为 HTTP 状态码（如 `ErrNotFound → 404`）
  - ✅ 每层用 `%w` 包装，保持 `errors.Is`/`errors.As` 可追溯
  - ❌ 禁止 Repository 层直接返回 HTTP 状态码
- **禁止 panic**：业务代码禁止 panic，仅允许 init() 和不可恢复场景
- **context 传递**：所有跨函数调用传 `context.Context` 作为第一个参数
- **nil 检查**：函数返回 error 时，调用者必须检查 error（不检查返回值）
- **包循环**：禁止包循环导入（编译器强制，但架构设计时需注意）
- **安全边界校验**（Tier 2，Q8=严格边界校验时激活）
  - 路径校验：使用 `filepath.Rel()` + `strings.HasPrefix` 检查路径遍历，禁止用户输入直接拼入文件路径
  - ID 校验：外部 API 使用 UUID 或 opaque token，禁止暴露自增 ID
  - SQL 注入：强制使用参数化查询（`db.Query("SELECT ... WHERE id = $1", id)`），禁止字符串拼接 SQL
  - API 枚举防护：统一错误响应，不泄露内部状态差异
  - ✅ `net/http` middleware 统一做 auth + input validation
  - ❌ 禁止 `fmt.Sprintf("SELECT * FROM %s", tableName)`

### 并发类

- **goroutine 生命周期**：每个 goroutine 必须有明确的退出机制（context cancel / done channel）
- **通道方向**：声明时标注方向（`chan<-` / `<-chan`）
- **sync vs channel**：状态同步用 `sync.Mutex`，数据传递用 channel
- **禁止共享内存**：优先"不要通过共享内存来通信，而要通过通信来共享内存"

### 测试类

- **table-driven tests**：测试模式统一使用 table-driven
- **测试文件**：`*_test.go` 与被测文件同目录
- **集成测试**：`*_test.go` + `//go:build integration` 标签
- **Benchmark**：`BenchmarkXxx(b *testing.B)` 放在测试文件中
- **TDD 流程**（Tier 2，Q7=TDD优先时激活）
  - 红灯→绿灯→重构：先写失败测试 → 最小实现通过 → 重构
  - 使用 `github.com/cweill/gotests` 生成测试骨架
  - ✅ Table-driven test 作为主要测试模式
  - ❌ 禁止先写实现再补测试
- **测试覆盖要求**（Tier 2，Q7=覆盖要求时激活）
  - 配置 `go test -cover`，设置覆盖阈值
  - 使用 `go test -coverprofile=coverage.out && go tool cover -func=coverage.out` 检查
  - ✅ CI 中 `go test -cover -coverprofile=coverage.out` + 阈值检查作为门禁
  - ❌ 禁止为凑覆盖率写无意义测试

## 框架特定规则

### Gin

| 规则 | 说明 |
|------|------|
| 路由分组 | `router.Group()` 按版本/模块分组，中间件挂载在 group 上 |
| 中间件 | `gin.HandlerFunc`，错误通过 `c.Error()` 传递 |
| 绑定 | `ShouldBindJSON` / `ShouldBindQuery`，禁止手动解析 |
| 响应 | `c.JSON(code, data)`，统一响应结构 |
| 事务 | Service 层管理事务边界，Handler 禁止持有 `*gorm.DB` 或 `*sqlx.DB` 事务对象 |
| 认证 | auth middleware 挂载在 router/group 上，新接口默认受保护 |
| CORS | `cors.Config{}` 集中配置，禁止 Handler 手动写 CORS header |
| 日志 | 检测到 zap/slog 时：结构化日志用 `zap.L().Info("msg", zap.String(...))`，禁止 `log.Printf` |
| 迁移 | 检测到 golang-migrate/goose 时：新增表/字段走迁移脚本，禁止手动 DDL |
| HTTP Client | 封装在 `internal/client/` 或 `pkg/httpclient/`，禁止 Handler 直接发起 HTTP 调用 |
| 定时任务 | 检测到 robfig/cron 时：任务定义在 `internal/job/` 或 `cmd/` 启动注册 |
| 对象存储 | 文件操作通过统一的 StorageService 封装，禁止 Handler 直接使用 S3/OSS Client |
| 配置 | 检测到 Viper 时：配置结构体用 `mapstructure` tag，新配置项同步更新 struct |
| 熔断限流 | 检测到 circuitbreaker 时：外部调用必须包裹在熔断器中 |
| WebSocket | 检测到 gorilla/websocket 时：Upgrader 配置集中管理，Hub 模式管理连接 |

### Echo

| 规则 | 说明 |
|------|------|
| 路由 | `e.Group()` 分组，`e.Use()` 中间件 |
| 绑定 | `echo.Bind()` 自动绑定 |
| 错误处理 | 自定义 `HTTPErrorHandler` 统一处理 |
| 中间件 | `e.Use()` 全局中间件，`e.Pre()` 在路由前执行（如 trailing slash） |
| 认证 | auth middleware 通过 `e.Use()` 或 group 挂载，新接口默认受保护 |
| CORS | `middleware.CORSWithConfig` 集中配置 |
| HTTP Client | 同 Gin 规则，封装在独立包中 |
| 定时任务 | 检测到 robfig/cron 时：通过 `e.OnStartup` 注册或独立 goroutine |
| 配置 | 检测到 Viper 时：配置结构体用 `mapstructure` tag |

### Fiber

| 规则 | 说明 |
|------|------|
| 路由 | `app.Group()` 分组，express 风格 API |
| handler | `fiber.Handler`，返回 error |
| 响应 | `c.JSON()` / `c.Status().JSON()` |

### 标准库 (net/http)

| 规则 | 说明 |
|------|------|
| Handler | `http.Handler` 接口 + `http.HandlerFunc` |
| 中间件 | 函数包装模式：`func(next http.Handler) http.Handler` |
| 路由 | Go 1.22+ `http.NewServeMux()` 支持方法路由 |

## 测试约定

- 框架：`testing` 标准库 + `testify`（断言）
- 模式：table-driven tests
- 命名：`TestXxx(t *testing.T)`，`Xxx` 为被测函数名首字母大写
- HTTP 测试：`httptest.NewRecorder()` + `httptest.NewRequest()`
- Mock：`gomock` 或接口 mock，禁止 mock 具体类型
- 集成测试：`//go:build integration` 标签，`-tags integration` 运行

## 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 包名 | 全小写，单个词 | `router`, `handler` |
| 导出标识符 | 首字母大写 | `SkillRouter` |
| 未导出标识符 | 首字母小写 | `matchSkills` |
| 接口 | `-er` 后缀（单方法） | `Matcher`, `Reader` |
| 错误变量 | `Err` 前缀 | `ErrNotFound` |
| 常量 | 首字母大写导出 / 小写未导出 | `MaxRetries` |
| 测试 | `Test` + 函数名 | `TestMatchSkills` |
| Benchmark | `Benchmark` + 函数名 | `BenchmarkMatchSkills` |
| 文件名 | snake_case | `skill_router.go` |
