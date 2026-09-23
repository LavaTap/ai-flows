# Python 项目语言参考资料

> 适用于：Python 3.10+ 项目，覆盖 FastAPI / Django / Flask 及通用 Python 项目

## 命令表

### 包管理器检测

| 文件 | 包管理器 | 安装依赖 | 添加依赖 | 运行 |
|------|---------|---------|---------|------|
| pyproject.toml + poetry.lock | Poetry | `poetry install` | `poetry add <pkg>` | `poetry run python <file>` |
| pyproject.toml + uv.lock | uv | `uv sync` | `uv add <pkg>` | `uv run python <file>` |
| requirements.txt | pip | `pip install -r requirements.txt` | 手动编辑 | `python <file>` |
| pyproject.toml + pdm.lock | pdm | `pdm install` | `pdm add <pkg>` | `pdm run python <file>` |

### 工具链命令

| 操作 | 命令 |
|------|------|
| 格式化 | `ruff format src/` |
| Lint | `ruff check src/ --fix` |
| 类型检查 | `mypy src/` |
| 测试 | `pytest tests/ -v` |
| 测试覆盖率 | `pytest tests/ --cov=src --cov-report=term-missing` |
| 全部门禁 | `pre-commit run --all-files` |

### 多包项目检测

| 信号 | 含义 | 检测方式 |
|------|------|---------|
| `pyproject.toml` 含 `[tool.poetry.group]` 或多个 `[project]` | Poetry 多环境/多包 | 读取 pyproject.toml |
| `pyproject.toml` 含 `[tool.pdm.scripts]` + 多个 `__pypackages__` | PDM 多包 | 读取 pyproject.toml |
| `src/` 下多个子目录各有 `__init__.py` | namespace packages / src layout 多包 | `find src/ -maxdepth 2 -name '__init__.py'` |
| 根目录 `requirements.txt` + 子目录各有 `requirements.txt` | pip 多环境拆分 | 检查子目录 |
| `pyproject.toml` 含 `[tool.hatch.envs]` 多环境 | Hatch 多环境 | 读取 pyproject.toml |

## 工具链覆盖清单

以下规则已被工具链强制执行，通常不需要写入 CLAUDE.md：

| 工具 | 覆盖的规则 |
|------|-----------|
| **Ruff format** | 缩进、引号风格、行宽、尾随空白、import 排序 |
| **Ruff lint (E/W/F/I)** | 语法错误、未使用导入、空白规范 |
| **Ruff lint (S)** | 安全反模式（assert in test、hardcoded password 等） |
| **Ruff lint (B)** | bugbear 反模式（mutable default arg 等） |
| **Ruff lint (TID251)** | 禁止特定 API 导入（如禁止 os.environ） |
| **MyPy strict** | 类型注解完整性、类型安全 |
| **import-linter** | 分层依赖方向、模块间导入约束 |
| **ast-grep** | AST 级别的模式禁止（async def、silent exception 等） |

## 优先级分层

生成 CLAUDE.md 时按以下优先级填充，空间不足时优先保证 Tier 1。

### Tier 1：核心规则（几乎所有项目）
- DI 注入规则（禁止手动实例化）
- 全局状态 Final 标注

### Tier 2：推荐规则（取决于项目风格）
- 分层约束（仅 DDD/Clean Architecture 项目）
- async/同步架构选择
- 异常处理策略
- 日志规范

### Tier 3：边缘场景（特定条件才需要）
- dataclass frozen（仅 DDD 项目 domain 层）
- 路径/ID 校验（仅涉及文件/用户输入操作）
- API 枚举约束（仅 API 接口层）
- 维护同步义务（仅项目有质量门禁时）

## 检测信号

### 数据库

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| PostgreSQL | pyproject.toml / requirements.txt | `psycopg2` / `psycopg2-binary` / `asyncpg` / SQLAlchemy `postgresql://` |
| MySQL | pyproject.toml / requirements.txt | `mysqlclient` / `pymysql` / `aiomysql` / SQLAlchemy `mysql://` |
| SQLite | Python 标准库 / SQLAlchemy | `sqlite3` / SQLAlchemy `sqlite://` |
| MongoDB | pyproject.toml / requirements.txt | `pymongo` / `motor` / `odmantic` |
| Redis | pyproject.toml / requirements.txt | `redis` / `aioredis` / `redis-py` |
| Elasticsearch | pyproject.toml / requirements.txt | `elasticsearch` / `opensearch-py` |
| 多数据库 | settings.py / Python 源码 | Django `DATABASES` 多键 / SQLAlchemy 多 engine / 读写分离配置 |
| ORM 框架 | pyproject.toml / Python 源码 | `sqlalchemy` / `tortoise-orm` / `django` ORM / `peewee` / `pony` |

### 事务 / 数据库配置

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Django 事务 | settings.py | `ATOMIC_REQUESTS` / `TransactionMiddleware` / `DATABASES['default']['ATOMIC_REQUESTS']` |
| Django 中间件 | settings.py | `MIDDLEWARE` 列表中的自定义中间件顺序 |
| Django 数据库路由 | settings.py | `DATABASE_ROUTERS` |
| SQLAlchemy session | Python 源码 | `scoped_session` / `sessionmaker` / `async_sessionmaker` / `SessionLocal` |

### 认证/鉴权

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Django auth | settings.py / Python 源码 | `AUTHENTICATION_BACKENDS` / custom `Backend` 类 |
| Django REST Framework | settings.py | `REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES']` / `DEFAULT_AUTHENTICATION_CLASSES` |
| FastAPI auth | Python 源码 | `Depends(oauth2_scheme)` / `get_current_user` / `HTTPBearer` / 自定义 auth dependency |
| Flask-Login | Python 源码 | `LoginManager` / `@login_required` / `current_user` |
| Flask-JWT | Python 源码 | `JWTManager` / `create_access_token` / `jwt_required` |

### 数据库迁移

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Alembic | `alembic.ini` / `alembic/` 目录 | `alembic revision` / `versions/` 目录 |
| Django migrations | `migrations/` 目录 | `makemigrations` / `migrate` 命令 |
| Aerich (Tortoise ORM) | `migrations/` 目录 | `aerich.ini` / `aerich migrate` |

### HTTP Client / 服务间调用

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| requests | pyproject.toml / Python 源码 | `requests.get` / `requests.post` / `Session()` |
| httpx | pyproject.toml / Python 源码 | `httpx.AsyncClient` / `httpx.get` / `httpx.post` |
| aiohttp | pyproject.toml / Python 源码 | `aiohttp.ClientSession` / `aiohttp.get` |
| gRPC 客户端 | pyproject.toml / Python 源码 | `grpcio` / `grpc.insecure_channel` / stub 导入 |
| tenacity (重试) | pyproject.toml / Python 源码 | `@retry` / `retry(stop=...)` / `tenacity` |

### 定时任务 / 后台作业

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Celery Beat | Python 源码 / settings | `CELERY_BEAT_SCHEDULE` / `crontab(` / `solar(` |
| APScheduler | pyproject.toml / Python 源码 | `apscheduler` / `BackgroundScheduler` / `@scheduler.scheduled_job` |
| Huey | pyproject.toml / Python 源码 | `huey` / `@huey.periodic_task` / `@db_task` |
| asyncio scheduling | Python 源码 | `asyncio.create_task` / `loop.call_later` |

### 对象存储 / 文件

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| boto3 (AWS S3) | pyproject.toml / Python 源码 | `boto3.client('s3')` / `boto3.resource('s3')` |
| MinIO | pyproject.toml / Python 源码 | `minio` / `Minio` / `presigned_get_object` |
| 阿里云 OSS | pyproject.toml / Python 源码 | `oss2` / `oss2.Auth` / `Bucket` |

### 配置中心（集中式）

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| python-decouple | pyproject.toml / Python 源码 | `decouple.config` / `.env` 文件 |
| dynaconf | pyproject.toml / Python 源码 | `dynaconf` / `settings.toml` / `Dynaconf` |
| Consul KV | pyproject.toml / Python 源码 | `consulate` / `python-consul` / `consul.kv.get` |
| etcd | pyproject.toml / Python 源码 | `etcd3` / `etcd.Client` |

### 限流 / 熔断 / 弹性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| circuitbreaker | pyproject.toml / Python 源码 | `@circuit` / `CircuitBreaker` |
| ratelimit | pyproject.toml / Python 源码 | `@sleep_and_retry` / `@limits` |
| slowapi | pyproject.toml / Python 源码 | `limiter.limit` / `Limiter` / FastAPI 集成 |

### WebSocket / SSE

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| FastAPI WebSocket | Python 源码 | `@app.websocket` / `WebSocket` / `websocket.accept` |
| Django Channels | pyproject.toml / Python 源码 | `channels` / `AsyncWebsocketConsumer` / `routing.py` |
| SSE | Python 源码 | `StreamingResponse` / `text/event-stream` / `sse-starlette` |

### 模板引擎

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Jinja2 | pyproject.toml / Python 源码 / templates 目录 | `jinja2` / `templates/` 目录 / `render_template` |
| Django templates | templates 目录 | `templates/` 目录 / `{% block %}` / `{% extends %}` |
| Mako | pyproject.toml / Python 源码 | `mako` / `.mako` 文件 |

### 测试基础设施

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Testcontainers | pyproject.toml / test 源码 | `testcontainers` / `DockerContainer` / `postgres container` |
| responses / vcr | pyproject.toml / test 源码 | `responses` / `@responses.activate` / `vcrpy` / `@vcr.use_cassette` |
| freezegun | pyproject.toml / test 源码 | `freezegun` / `@freeze_time` |
| factory_boy | pyproject.toml / test 源码 | `factory` / `Factory` / `SubFactory` |

### 日志/可观测性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| structlog | pyproject.toml / Python 源码 | `structlog.configure` / `structlog.get_logger` |
| Sentry | pyproject.toml / Python 源码 | `sentry-sdk` / `sentry_sdk.init` |
| logging 配置 | settings.py / logging.conf | `LOGGING` dict / `dictConfig` |

### 消息队列

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Celery | Python 源码 / settings | `@app.task` / `CELERY_TASK_ROUTES` / `CELERY_BROKER_URL` |
| Redis Streams | Python 源码 | `xread` / `xadd` / `aioredis` |
| Kafka (aiokafka) | Python 源码 | `AIOKafkaConsumer` / `AIOKafkaProducer` |

### 缓存

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Django cache | settings.py | `CACHES` dict / `cache_page` / `@cache_page` |
| Redis cache | Python 源码 | `redis.Redis` / `aioredis` / `@cached` (cachetools) |
| FastAPI cache | Python 源码 | `fastapi-cache2` / `@cache()` decorator |

### API 文档

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| FastAPI auto-docs | Python 源码 | `FastAPI(title=` / `description=` / `tags_metadata` |
| DRF Spectacular | settings.py | `SPECTACULAR_SETTINGS` / `@extend_schema` |
| DRF Swagger/YASG | settings.py | `SWAGGER_SETTINGS` / `@swagger_auto_schema`（已过时） |

### CORS

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| FastAPI CORS | Python 源码 | `CORSMiddleware` / `app.add_middleware(CORSMiddleware)` |
| Django CORS | settings.py / pyproject.toml | `django-cors-headers` / `CORS_ALLOW_ALL_ORIGINS` / `CORS_ALLOWED_ORIGINS` |
| Flask CORS | Python 源码 | `flask-cors` / `CORS(app)` |

### Web 框架配置

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| FastAPI 中间件 | Python 源码 | `app.add_middleware()` / `@app.middleware("http")` |
| FastAPI 生命周期 | Python 源码 | `@app.on_event("startup")` / `lifespan` |
| Pytest 配置 | pyproject.toml / pytest.ini | `[tool.pytest.ini_options]` / `conftest.py` 层级 |

## Python 特有约束（候选规则池）

以下规则是 Python 项目中常见需要写入 CLAUDE.md 的候选：

### 架构类

- **分层约束**：如果项目采用 DDD/Clean Architecture，定义各层允许/禁止的导入
- **组合根**：DI 组合根的跨层导入豁免
- **async/同步架构**：明确项目是全同步还是全异步（反直觉：FastAPI 项目可能全同步）
- **DI 规则**：所有依赖通过 DI 框架（Dishka/python-inject/dependency-injector）注入，禁止手动实例化

### 代码规范类

- **dataclass frozen**：domain 层 dataclass 必须 `frozen=True`
- **全局状态**：模块级变量必须 `Final` 标注，缓存需豁免注释
- **异常三阶段**：domain raise → application 透传 → interface 全局拦截
- **各层独立异常处理**（Tier 2，Q4=各层独立时激活）
  - Repository 层：捕获数据库异常（如 `IntegrityError`、`OperationalError`），抛出领域异常
  - Service 层：捕获领域异常，包装为业务异常（如 `BusinessError`），附加业务上下文
  - API 层：捕获业务异常，映射为 HTTP 状态码（如 `BusinessError → 422`）
  - ✅ 每层仅转换异常类型，不吞掉原始异常信息
  - ❌ 禁止 Repository 层直接抛出 HTTP 相关异常（层级跨越）
- **日志**：使用 structlog 而非 logging，except 记录用 `exc_info=True`

### 边界校验类

- **路径校验**：`Path.resolve()` + `is_relative_to()` 防路径遍历，使用白名单目录检查
- **ID 校验**：所有资源 ID 使用 UUID，禁止自增 ID 暴露给外部 API，拒绝 `/`、`\`、`..`
- **API 枚举**：`Literal[...]` 或 `Field(pattern=...)`
- **安全边界校验**（Tier 2，Q8=严格边界校验时激活）
  - 路径校验：禁止用户输入直接拼入文件路径，使用 `pathlib.Path.resolve()` + 白名单目录检查
  - ID 校验：所有资源 ID 使用 UUID，禁止自增 ID 暴露给外部 API
  - API 枚举防护：敏感操作不返回差异化的错误信息（如"用户不存在"和"密码错误"统一返回"认证失败"）
  - ✅ Pydantic model 校验入参，FastAPI 依赖注入做权限检查
  - ❌ 禁止 `os.path.join(user_input, filename)` 未做路径遍历检查

### 维护义务类

- **Provider 同步**：新增 @provide 方法时同步更新 PROHIBITED_INSTANTIATION 列表
- **import-linter 同步**：新增跨层导入豁免时同步更新 ignore_imports

## 框架特定规则

### FastAPI

| 规则 | 说明 |
|------|------|
| DI 注入 | 通过 Dishka `setup_dishka` 或 FastAPI `Depends()` |
| 异常处理 | `app.add_exception_handler()` 全局拦截，路由函数禁止 try/except |
| 异步架构 | 可全同步（threading 后台任务）或全异步，必须明确 |
| 配置管理 | `pydantic-settings` + `BaseSettings`，环境变量前缀 |
| 请求模型 | Pydantic `BaseModel` + `Field()` 校验，枚举用 `Literal[...]` |
| 认证 | `Depends(get_current_user)` 统一鉴权，新接口默认需要认证 |
| CORS | 集中在 `app.add_middleware(CORSMiddleware)` 配置，禁止路由级 CORS |
| 消息队列 | Celery task 仅做反序列化+调用 Service，禁止在 task 中写业务逻辑 |
| 缓存 | 检测到 fastapi-cache2 时：`@cache()` 放在 Service 层，key 包含业务标识 |
| HTTP Client | 检测到 httpx 时：异步调用用 `httpx.AsyncClient`，统一超时和重试配置 |
| 定时任务 | 检测到 APScheduler 时：任务定义集中在 `tasks/` 或 `jobs/` 目录 |
| 对象存储 | 文件操作通过统一的 StorageService 封装，禁止直接使用 boto3/MinIO Client |
| WebSocket | `@app.websocket` handler 仅做连接管理，消息处理逻辑放在 Service 层 |
| SSE | `StreamingResponse(generator, media_type="text/event-stream")` 用于实时推送 |

### Django

| 规则 | 说明 |
|------|------|
| 分层 | Views → Services → Models（禁止 View 直接 ORM 查询） |
| ORM | 仅 Service 层操作 Model，View 层通过 Service 中转 |
| URL 路由 | `urls.py` 集中注册，app 级别 include |
| 配置 | `settings.py` + `.env`（django-environ） |
| 事务 | `ATOMIC_REQUESTS=True` 时 View 自动事务包裹；否则 Service 层用 `@transaction.atomic` |
| 中间件 | `MIDDLEWARE` 列表顺序有语义（请求从上到下，响应从下到上），变更时需记录顺序依赖 |
| 认证 | `AUTHENTICATION_BACKENDS` 集中配置，新 View 用 `@permission_required` 或 DRF `permission_classes` |
| 迁移 | 检测到 `migrations/` 时禁止手动改库结构，走 `makemigrations` + `migrate` |
| 缓存 | `CACHES` 集中配置，`@cache_page` 仅放在 View 层 |
| API 文档 | 检测到 DRF Spectacular 时：新接口必须加 `@extend_schema` |
| CORS | `django-cors-headers` 集中配置，`CORS_ALLOWED_ORIGINS` 白名单 |
| HTTP Client | 检测到 httpx/requests 时：调用封装在 Service 层，View 禁止直接发起 HTTP 请求 |
| 定时任务 | 检测到 Celery Beat 时：定时任务定义在 `tasks.py`，用 `CELERY_BEAT_SCHEDULE` 注册 |
| 对象存储 | 文件操作通过统一的 StorageService 封装，禁止直接使用 boto3 |
| WebSocket | 检测到 Channels 时：Consumer 仅做连接管理，消息处理在 Service 层 |
| 测试 | `pytest-django` + fixtures |

### Flask

| 规则 | 说明 |
|------|------|
| 蓝图 | 按功能模块拆分 Blueprint |
| 工厂模式 | `create_app()` 工厂函数 |
| 配置 | `app.config.from_object()` + 环境变量 |
| 扩展初始化 | 扩展在 `create_app()` 中初始化并绑定 app，禁止模块级初始化 |
| 认证 | 检测到 Flask-Login 时：`@login_required` 保护路由；检测到 JWT 时：`@jwt_required()` |
| CORS | `flask-cors` 在 `create_app()` 中初始化，禁止路由级 CORS |
| HTTP Client | 调用封装在 Service 层，Blueprint 禁止直接发起 HTTP 请求 |
| 定时任务 | 检测到 APScheduler 时：任务定义集中在独立模块，通过 `create_app()` 注册 |
| 测试 | pytest + Flask test client |

## 测试约定

- 框架：pytest（禁止 unittest）
- 目录：`tests/` 镜像 `src/` 结构
- 命名：`test_<模块名>.py`，函数 `test_<场景>_<预期结果>`
- 依赖 mock：通过 DI 框架的 MockProvider（如 Dishka MockProvider），禁止手动 mock
- 禁止 mock 领域层：业务逻辑测试使用真实对象
- fixtures：`conftest.py` 共享 fixtures
- **TDD 流程**（Tier 2，Q7=TDD优先时激活）
  - 红灯→绿灯→重构循环：先写失败测试 → 最小实现通过 → 重构
  - 使用 `pytest-watch` 自动运行（`ptw --clear`）
  - ✅ 每个新功能/修复从写测试开始
  - ❌ 禁止先写实现再补测试
- **测试覆盖要求**（Tier 2，Q7=覆盖要求时激活）
  - 配置 `pytest-cov`，设置 `fail_under` 阈值（如 ≥ 80%）
  - 覆盖率只看业务逻辑层（Service/Domain），不要求 Controller/Config 层
  - ✅ CI 中 `pytest --cov --cov-fail-under=80` 作为门禁
  - ❌ 禁止为凑覆盖率写无意义测试

## 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 模块文件 | snake_case | `condition_evaluator.py` |
| 类名 | PascalCase | `SkillRouterService` |
| DI Provider 文件 | `*_provider.py` | `service_provider.py` |
| 配置模型 | `*Settings` / `*Config` | `AppConfig`, `DatabaseSettings` |
| Protocol 接口 | `*Protocol` | `SkillLoaderProtocol` |
| Repository 接口 | `*Repository` | `IntentStackRepository` |
| 常量 | UPPER_SNAKE_CASE + `Final` | `PACKAGE_ROOT: Final[str]` |
