# Java 项目语言参考资料

> 适用于：Java 17+ 项目，覆盖 Spring Boot / Quarkus / Micronaut 及通用 Java 项目

## 命令表

### 构建工具检测

| 文件 | 构建工具 | 编译 | 测试 | 打包 | 运行 |
|------|---------|------|------|------|------|
| pom.xml | Maven | `mvn compile` | `mvn test` | `mvn package` | `mvn spring-boot:run` |
| build.gradle(.kts) | Gradle | `./gradlew build` | `./gradlew test` | `./gradlew jar` | `./gradlew bootRun` |

### 工具链命令

| 操作 | Maven | Gradle |
|------|-------|--------|
| Lint (Checkstyle) | `mvn checkstyle:check` | `./gradlew checkstyleMain` |
| Lint (PMD) | `mvn pmd:check` | `./gradlew pmdMain` |
| 静态分析 (SpotBugs) | `mvn spotbugs:check` | `./gradlew spotbugsMain` |
| 格式化 | `mvn spotless:apply` 或 `./gradlew spotlessApply` | |
| 架构检查 (ArchUnit) | 通过测试执行 | 通过测试执行 |
| 全部检查 | `mvn verify` | `./gradlew check` |

### 多模块项目检测

| 信号 | 含义 | 检测方式 |
|------|------|---------|
| 根 pom.xml `<packaging>pom</packaging>` | Maven 多模块项目 | 读取根 pom.xml |
| 根 pom.xml `<modules>` | 子模块列表 | 遍历 `<module>` 值查找子模块 pom.xml |
| 子模块 pom.xml `<parent>` 含 `spring-boot-starter-parent` | 该子模块是 Spring Boot 应用 | 读取子模块 pom.xml |
| 根 pom.xml `<dependencyManagement>` 含 Spring Boot BOM | 继承版本管理，非实际使用 | 仅作版本参考，不作为框架判定 |
| 子模块 pom.xml `<dependencies>` 含 `spring-boot-starter-*` | 该子模块实际使用 Spring Boot | 以此为准推断框架 |

## 工具链覆盖清单

| 工具 | 覆盖的规则 |
|------|-----------|
| **Checkstyle** | 代码风格：缩进、大括号位置、行宽、import 排序、Javadoc |
| **PMD** | 代码质量：空 catch 块、过长方法、God Class、未使用字段 |
| **SpotBugs** | Bug 模式：空指针、资源泄漏、equals/hashCode 不一致 |
| **Error Prone** | 编译期 Bug 检测：常见编程错误 |
| **ArchUnit** | 分层约束、包依赖方向、命名约定 |
| **Spotless** | 代码格式化（google-java-format 或 palantir） |
| **google-java-format** | 缩进 2 空格、大括号风格、行宽 100 |

## 优先级分层

生成 CLAUDE.md 时按以下优先级填充，空间不足时优先保证 Tier 1。

### Tier 1：核心规则（几乎所有项目）
- DI 方式：构造器注入优先，@Autowired 仅用于测试
- DTO 隔离：Controller 接收/返回 DTO，Service 操作 Domain Model
- 全局异常处理：@ControllerAdvice + @ExceptionHandler

### Tier 2：推荐规则（取决于项目风格）
- 分层约束：Controller → Service → Repository → Entity
- 包结构：按功能模块 vs 按层分包，明确选择
- 事务管理：@Transactional 仅放在 Service 层（检测：spring-tx / spring-boot-starter-jpa / spring-boot-starter-jdbc）
- 不可变性：参数和变量尽量 final
- Early return 优先

### Tier 3：边缘场景（特定条件才需要）
- 避免 Lombok @Data
- 显式类型（避免 var）
- 注释最小化策略
- MapStruct 映射规范

## 检测信号

### 数据库

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| MySQL | pom.xml / build.gradle / application.yml | `mysql-connector-java` / `com.mysql.cj` / `spring.datasource.url` 含 `mysql` |
| PostgreSQL | pom.xml / build.gradle / application.yml | `postgresql` / `org.postgresql` / `spring.datasource.url` 含 `postgresql` |
| Oracle | pom.xml / build.gradle | `ojdbc` / `oracle.jdbc` |
| SQL Server | pom.xml / build.gradle | `mssql-jdbc` / `com.microsoft.sqlserver` |
| SQLite | pom.xml / build.gradle | `sqlite-jdbc` |
| H2 (测试) | pom.xml / build.gradle / application.yml | `h2` / `spring.datasource.url` 含 `h2` |
| MongoDB | pom.xml / build.gradle / application.yml | `spring-boot-starter-data-mongodb` / `spring.data.mongodb.uri` |
| Elasticsearch | pom.xml / build.gradle | `spring-boot-starter-data-elasticsearch` |
| 多数据源 | application.yml / Java 源码 | 多个 `DataSource` bean / `@Primary` DataSource / `AbstractRoutingDataSource` |
| 连接池 | pom.xml / application.yml | `HikariCP`（默认）/ `druid` / `tomcat-jdbc` / `spring.datasource.hikari.*` |
| ORM 框架 | pom.xml / build.gradle | `spring-boot-starter-data-jpa` / `mybatis-spring-boot-starter` / `mybatis-plus` / `jooq` |

### 事务管理

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring 事务 | pom.xml / build.gradle | `spring-tx` / `spring-boot-starter-data-jpa` / `spring-boot-starter-jdbc` |
| 注解式事务 | Java 源码 | `@Transactional` / `@EnableTransactionManagement` |
| 拦截器式事务（AOP） | Java 源码 | `TransactionInterceptor` bean / `NameMatchTransactionAttributeSource` / `TransactionManager` 参数注入 |
| MyBatis + 事务 | Java 源码 | `@MapperScan` + `TransactionInterceptor` 同一 `@Configuration` 类 |
| JTA / 分布式事务 | pom.xml / build.gradle | `javax.transaction` / `jakarta.transaction` / `jta` / `seata` / `atomikos` |
| 自定义事务管理器 | Java 源码 | `PlatformTransactionManager` / `JtaTransactionManager` bean |

### 认证/鉴权

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring Security | pom.xml / build.gradle | `spring-security-web` / `spring-boot-starter-security` |
| Security filter chain | Java 源码 | `SecurityFilterChain` bean / `@EnableWebSecurity` / `HttpSecurity` |
| 方法级鉴权 | Java 源码 | `@PreAuthorize` / `@Secured` / `@RolesAllowed` |
| JWT | pom.xml / Java 源码 | `jjwt` / `java-jwt` / `JwtDecoder` bean / `JwtAuthenticationFilter` |
| OAuth2 | pom.xml / Java 源码 | `spring-boot-starter-oauth2-client` / `spring-boot-starter-oauth2-resource-server` |

### 数据库迁移

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Flyway | pom.xml / SQL 文件 | `flyway-core` / `db/migration/V*.sql` |
| Liquibase | pom.xml / XML/YAML 文件 | `liquibase-core` / `db/changelog/` / `changelog*.xml` |
| Hibernate DDL auto | application.yml / .properties | `spring.jpa.hibernate.ddl-auto` 值 |

### HTTP Client / 服务间调用

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| RestTemplate | Java 源码 | `RestTemplate` bean / `restTemplate.getForObject` |
| WebClient | pom.xml / Java 源码 | `spring-boot-starter-webflux` / `WebClient` bean / `webClient.get()` |
| OpenFeign | pom.xml / Java 源码 | `spring-cloud-starter-openfeign` / `@FeignClient` / `@EnableFeignClients` |
| OkHttp | pom.xml / Java 源码 | `okhttp` / `OkHttpClient` |
| Retrofit | pom.xml / Java 源码 | `retrofit` / `Retrofit.Builder` |
| gRPC 客户端 | pom.xml / Java 源码 | `grpc-stub` / `ManagedChannel` / `grpc-spring-boot-starter` |

### 定时任务 / 后台作业

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring @Scheduled | Java 源码 | `@Scheduled` / `@EnableScheduling` / `fixedRate` / `cron` |
| Quartz | pom.xml / Java 源码 | `quartz` / `spring-boot-starter-quartz` / `@DisallowConcurrentExecution` |
| XXL-Job | pom.xml / Java 源码 | `xxl-job-core` / `@XxlJob` / `XxlJobHandler` |
| ElasticJob | pom.xml / Java 源码 | `elasticjob` / `@SimpleJob` |
| Spring Batch | pom.xml / Java 源码 | `spring-boot-starter-batch` / `@BatchMapping` / `ItemReader` |

### 对象存储 / 文件

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| AWS S3 | pom.xml / Java 源码 | `aws-java-sdk-s3` / `software.amazon.awssdk.s3` / `S3Client` |
| MinIO | pom.xml / Java 源码 | `minio` / `MinioClient` / `io.minio` |
| 阿里云 OSS | pom.xml / Java 源码 | `aliyun-sdk-oss` / `OSSClient` |
| Spring Resource | Java 源码 | `MultipartFile` / `ResourceLoader` / 文件上传下载封装层 |

### 配置中心（集中式）

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Nacos | pom.xml / bootstrap.yml | `spring-cloud-starter-alibaba-nacos-config` / `nacos.config.server-addr` |
| Apollo | pom.xml / Java 源码 | `apollo-client` / `@Value("${xxx}")` + apollo meta |
| Spring Cloud Config | pom.xml / bootstrap.yml | `spring-cloud-starter-config` / `spring.cloud.config.uri` |
| Consul Config | pom.xml / application.yml | `spring-cloud-starter-consul-config` / `spring.cloud.consul.config` |

### 限流 / 熔断 / 弹性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Resilience4j | pom.xml / Java 源码 | `resilience4j-spring-boot2` / `@CircuitBreaker` / `@RateLimiter` / `@Retry` |
| Sentinel | pom.xml / Java 源码 | `sentinel-spring-boot-starter` / `@SentinelResource` / `FlowRule` |
| Spring Retry | pom.xml / Java 源码 | `spring-retry` / `@Retryable` / `@EnableRetry` |

### WebSocket / SSE

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring WebSocket | pom.xml / Java 源码 | `spring-boot-starter-websocket` / `@ServerEndpoint` / `WebSocketHandler` |
| STOMP | Java 源码 | `@MessageMapping` / `SimpMessagingTemplate` / `@EnableWebSocketMessageBroker` |
| SSE | Java 源码 | `SseEmitter` / `text/event-stream` |

### 模板引擎

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Thymeleaf | pom.xml / templates 目录 | `spring-boot-starter-thymeleaf` / `templates/*.html` / `th:text` |
| Freemarker | pom.xml / templates 目录 | `freemarker` / `templates/*.ftl` |
| Velocity | pom.xml / templates 目录 | `velocity` / `templates/*.vm`（已过时） |
| Mustache | pom.xml / templates 目录 | `spring-boot-starter-mustache` / `templates/*.mustache` |

### 测试基础设施

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Testcontainers | pom.xml / test 源码 | `testcontainers` / `@Container` / `@Testcontainers` |
| WireMock | pom.xml / test 源码 | `wiremock` / `@AutoConfigureWireMock` / `WireMockServer` |
| MockMvc | test 源码 | `@WebMvcTest` / `mockMvc.perform` |
| REST Assured | pom.xml / test 源码 | `rest-assured` / `given().when().then()` |

### 日志/可观测性

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Logback | `logback-spring.xml` / `logback.xml` | 日志格式、级别、appender 配置 |
| Micrometer | pom.xml / Java 源码 | `micrometer-registry-*` / `MeterRegistry` bean |
| Spring Actuator | pom.xml | `spring-boot-starter-actuator` |
| Sleuth / Zipkin | pom.xml | `spring-cloud-starter-sleuth` / `zipkin` |

### 消息队列

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring Kafka | pom.xml / Java 源码 | `spring-kafka` / `@KafkaListener` / `KafkaTemplate` |
| Spring AMQP (RabbitMQ) | pom.xml / Java 源码 | `spring-boot-starter-amqp` / `@RabbitListener` / `RabbitTemplate` |
| Spring Cloud Stream | pom.xml / Java 源码 | `spring-cloud-stream` / `@StreamListener` / `@Bean Function` |

### 缓存

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring Cache | Java 源码 | `@EnableCaching` / `@Cacheable` / `@CacheEvict` / `CacheManager` bean |
| Redis | pom.xml / application.yml | `spring-boot-starter-data-redis` / `RedisTemplate` bean / `spring.redis.*` |

### API 文档

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| SpringDoc (OpenAPI 3) | pom.xml / Java 源码 | `springdoc-openapi-starter-webmvc-ui` / `@Operation` / `@Tag` |
| Springfox (Swagger 2) | pom.xml / Java 源码 | `springfox-boot-starter` / `@Api` / `@ApiOperation`（已过时，建议迁移） |

### CORS

| 技术栈 | 检测文件/模式 | 检测关键字 |
|--------|-------------|-----------|
| Spring CORS 配置 | Java 源码 | `CorsConfigurationSource` bean / `@CrossOrigin` / `cors()` in SecurityFilterChain |
| application.yml CORS | application.yml | `spring.web.cors.*` / `spring.mvc.cors.*` |

## Java 特有约束（候选规则池）

### 架构类

- **分层约束**：Controller → Service → Repository → Entity，明确各层职责
- **DTO 隔离**：Controller 接收/返回 DTO，Service 操作 Domain Model，Entity 映射数据库
- **包结构**：按功能模块分包（com.example.feature.*）vs 按层分包（com.example.controller.*），明确选择
- **DI 方式**：构造器注入优先，`@Autowired` 仅用于测试
- **工厂模式 DI**（Tier 2，Q3=手动时激活）
  - ✅ 通过 Factory 类统一创建实例：`ServiceFactory.createUserService()`
  - ✅ Factory 方法返回接口类型，不返回具体实现
  - ❌ 禁止直接 `new ServiceImpl()`（除 Factory 内部）
  - ❌ 禁止在 Factory 外部持有实现类的直接引用

### 代码规范类

- **不可变性**：参数和变量尽量 `final`，优先不可变对象
- **避免 Lombok @Data**：用 `@Getter` / `@Setter` 精细控制，或用 `java.util.Record`
- **显式类型**：避免 `var`，用显式类型声明（提高可读性）
- **Early return**：优先 early return，避免 else 嵌套
- **注释最小化**：仅保留 cron 表达式、Regex、TODO 和测试的 given/when/then
- **事务管理**：`@Transactional` 仅放在 Service 层（检测：spring-tx / spring-boot-starter-jpa / spring-boot-starter-jdbc）

### 异常处理类

- **全局异常处理**：`@ControllerAdvice` + `@ExceptionHandler` 统一拦截
- **Service 层**：抛出业务异常（自定义异常类），不 catch
- **Controller 层**：禁止 try-catch，由全局处理器拦截
- **各层独立异常处理**（Tier 2，Q4=各层独立时激活）
  - DAO 层：捕获技术异常，抛出 `RuntimeException`（禁止抛出受检异常）
  - Service 层：捕获 RuntimeException，包装为业务异常（如 `BusinessException`）
  - API/Controller 层：捕获业务异常，映射为 HTTP 状态码
  - ✅ 每层仅处理本层关注点，不吞掉上层异常信息
  - ❌ 禁止 DAO 层直接抛出业务异常（层级跨越）

### 事务管理类

- **注解式事务**（Tier 2）：`@Transactional` 仅放在 Service 层，`readOnly=true` 用于查询方法
- **拦截器式事务**（Tier 2，检测到 `TransactionInterceptor` bean 时激活）
  - 事务边界由 `TransactionInterceptor` + `NameMatchTransactionAttributeSource` 统一配置
  - 识别 `@Configuration` 类中 `@Bean` 返回 `TransactionInterceptor` 的方法
  - 事务切面（AOP pointcut）决定哪些包/类/方法被拦截——需在 CLAUDE.md 中记录拦截范围
  - ✅ 新增 Service 方法遵循已有方法命名约定（如 `save*`/`update*`/`delete*` 走写事务，`get*`/`find*`/`query*` 走只读）
  - ❌ 禁止混用 `@Transactional` 注解与拦截器式事务（二选一，避免冲突）
  - ❌ 禁止绕过事务拦截器直接调用 DAO（同类内部调用不走代理）
- **事务传播**（Tier 2）：明确传播行为（`REQUIRED` / `REQUIRES_NEW` / `NESTED`）
- **分布式事务**（Tier 3，Q9 或分布式框架依赖时激活）：JTA / Seata / Atomikos / Bitronix

### 测试类

- **JUnit 5** + Mockito
- **分层测试**：`@WebMvcTest`（Controller）、`@SpringBootTest`（集成）、纯单元测试
- **命名**：`should_预期结果_when_条件` 或 `methodName_场景_预期`
- **结构**：given / when / then

## 框架特定规则

### Spring Boot

| 规则 | 说明 |
|------|------|
| DI 注入 | 构造器注入优先：`@RequiredArgsConstructor` + `final` 字段 |
| 事务 | `@Transactional` 仅放在 Service 层，readOnly 用于查询方法 |
| 分布式事务 | 检测到 Seata/Atomikos 时：`@GlobalTransactional` 仅放在 Service 层入口 |
| 配置 | `@ConfigurationProperties` 替代多个 `@Value` |
| 异常 | `@ControllerAdvice` + `@ExceptionHandler` + 自定义 `ErrorResponse` |
| API 校验 | `@Valid` + Bean Validation（`@NotNull`, `@Size`, `@Pattern`） |
| 分页 | Spring Data `Pageable`，禁止手动分页 |
| 映射 | MapStruct `@Mapper(componentModel = "spring")` 或静态 Mapper |
| 安全 | `SecurityFilterChain` bean 定义鉴权规则，新接口需确认是否需要 `@PreAuthorize` |
| 数据库迁移 | 检测到 Flyway/Liquibase 时禁止 `ddl-auto=create/update`，新增表/字段走迁移脚本 |
| 缓存 | 检测到 `@EnableCaching` 时：`@Cacheable` 放在 Service 层，key 包含业务标识 |
| 消息队列 | Consumer 方法禁止包含业务逻辑，仅做反序列化后调用 Service |
| API 文档 | 检测到 SpringDoc 时：新接口必须加 `@Operation` 和 `@Tag` |
| CORS | 集中在 `SecurityFilterChain` 或 `WebMvcConfigurer` 配置，禁止 Controller 级 `@CrossOrigin` |
| 日志 | 检测到 Micrometer 时：业务指标用 `Counter` / `Timer`，禁止 System.out |
| HTTP Client | 检测到 Feign 时：新接口用 `@FeignClient` 声明；检测到 WebClient 时：非阻塞调用用 WebClient，禁止混用 RestTemplate |
| 定时任务 | `@Scheduled` 方法放在独立的 `*Job` / `*Task` 类中，禁止在 Service 中直接标注 |
| 对象存储 | 文件操作通过统一的 StorageService 封装，禁止直接使用 S3/OSS Client |
| 配置中心 | 检测到 Nacos/Apollo 时：动态配置用 `@RefreshScope` 或 `@NacosValue`，新配置项加到远程配置中心 |
| 熔断限流 | 检测到 Resilience4j/Sentinel 时：外部调用必须加 `@CircuitBreaker` / `@SentinelResource` |
| WebSocket | 检测到 `@MessageMapping` 时：消息处理逻辑放在 Service 层，Handler 仅做路由 |

### Quarkus

| 规则 | 说明 |
|------|------|
| DI | CDI（`@Inject` + `@ApplicationScoped`） |
| 配置 | `application.properties` / `application.yml` + `@ConfigProperty` |
| 响应式 | 默认响应式，明确阻塞 vs 非阻塞边界 |

### Micronaut

| 规则 | 说明 |
|------|------|
| DI | 编译时注入（`@Inject` + `@Singleton`） |
| 配置 | `application.yml` + `@Value` / `@ConfigurationProperties` |

## 测试约定

- 框架：JUnit 5 + Mockito + Spring Boot Test
- 命名：`XxxTest.java`，测试目录镜像 `src/main/java` 结构
- 结构：given / when / then
- 集成测试：`@SpringBootTest` + `@Testcontainers`（数据库测试）
- Controller 测试：`@WebMvcTest` + MockMvc
- 避免反射测试（不测私有方法）

## 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 类名 | PascalCase | `SkillRouterService` |
| 方法名 | camelCase | `matchSkills()` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 包名 | 全小写，点分隔 | `com.example.skill.router` |
| 接口 | 无前缀/后缀或 `I` 前缀（统一选择） | `SkillRepository` |
| 实现类 | `*Impl` 或 `Default*` | `InMemorySkillRepository` |
| DTO | `*Request` / `*Response` / `*Dto` | `SkillLoadRequest` |
| 异常 | `*Exception` / `*Error` | `SkillLoadException` |
| 测试 | `*Test` | `SkillRouterServiceTest` |
| 配置类 | `*Config` / `*Configuration` | `SecurityConfig` |
