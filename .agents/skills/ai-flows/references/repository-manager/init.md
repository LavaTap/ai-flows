# 仓库初始化业务（接入 ai-review 评审链）

> 业务文档：由主文档 `SKILL.md` 在「初始化仓库 / 接入评审」意图下路由到这里。

## 触发条件

用户说「初始化仓库」「接入评审」「装 ai-review」「给这个仓库配上代码评审」「初始化 Research-Crawler」等。

## 1. 初始化仓库

1. 确认目标仓库路径（用户给定或当前工作目录）。必须是有 `.git` 的 git 仓库。
2. 运行脚本：

   ```bash
   node <skill-dir>/scripts/init-repo.mjs <target-repo-path>
   ```

   `<skill-dir>` = 主文档 `SKILL.md` 所在目录（`…/.agents/skills/ai-flows`）。
   不带参数时默认取当前工作目录。

3. 脚本做三件事：
   - 校验目标是 git 仓库（不是则退出码 1）
   - 从 ai-flows 项目拷贝 `config.example.json` → `<target>/ai-review.config.json`（已存在则跳过）
   - 在 `<target>/.git/hooks/pre-push` 安装 hook（已有则备份为 `pre-push.bak-<ts>`）

## 2. 检查模型密钥是否有效（初始化后必做）

初始化完仓库，紧接着校验模型密钥，密钥无效则引导用户重配。

1. 运行脚本（默认读取当前目录的 `ai-review.config.json`）：

   ```bash
   node <skill-dir>/scripts/check-key.mjs [config-path]
   ```

2. 脚本读取 config 的 `model` 段，按 `model.apiKey` > `model.apiKeyEnv` 指向的环境变量解析密钥，向 `model.baseUrl` 发一个最小 `chat/completions` 请求验证。
3. 结果处理：
   - **退出码 0（密钥有效）**：把结果转告用户，提示可以正常跑评审。
   - **退出码 1（缺失/无效）**：脚本已打印「重新配置密钥与模型」指引，**原样转达给用户**，并等用户配好后再重跑本脚本确认。

## 3. 推送前置检查（私有仓库凭据）

推送前先跑检查，确认「认证可用 + 无凭据泄露」：

```bash
node <skill-dir>/scripts/check-remote-auth.mjs [repo-path]
```

脚本**只读**检查三件事，不做任何修改：远端可达性、凭据就绪、泄露风险。
退出码 `0` 无问题 / `1` 有阻塞项。

### 密钥配置由谁做

agent **可以**自己完成密钥全流程，但分两截：

| 环节 | agent 能否自动化 | 做法 |
|---|---|---|
| 生成密钥对 | 能 | `ssh-keygen -t ed25519 -N "" -C "<邮箱>"` |
| 写 `~/.ssh/config` | 能 | 22 被墙时配 `Host github.com` → `HostName ssh.github.com` / `Port 443` / `User git` |
| 验证认证 | 能 | `ssh -T git@github.com`（成功也返回非 0，看输出文本） |
| **上传公钥到平台** | 看情况 | 有 `gh` CLI 且已登录 → `gh ssh-key add ~/.ssh/id_ed25519.pub`；否则要 PAT（`admin:public_key`）或浏览器操作，或用户手动粘贴 |

**上传公钥是唯一需要外部授权的一步**：既没有 `gh` 也没有 PAT 时，agent 做不到，必须由用户手动粘贴一次。

### 泄露风险是硬门禁

`git ls-files` 里若出现 cookie / `.pkl` / `secret` / `.env` / `accounts.json` 之类文件，**推送会把它们一并上传**（包括推送到私有仓库——私有不等于安全）。处理方式：

```bash
git rm --cached "<file>"     # 只停止跟踪，本地文件保留
# 再把规则写进 .gitignore，避免再次误加
```

若这些文件**已经推到过远端**，凭据必须视为已泄露，直接轮换，仅删除跟踪不够。

## 4. 收尾提醒

- 设置模型 API Key 环境变量（默认 `DEEPSEEK_API_KEY`，或改 config 的 `model.apiKeyEnv`）
- 按需修改 `ai-review.config.json` 里的 `model` 与 `targets`
- 之后 `git push` 会先被 hook 拦截跑评审，再到评审页面点「确认提交」由服务代为推送

## 路径约定

业务脚本位于 `<skill-dir>/scripts/`：`init-repo.mjs`、`check-key.mjs`、`check-remote-auth.mjs`。
`init-repo.mjs` 相对自身定位 ai-flows 项目根（向上 4 级），再找 `config.example.json` 与 `src/index.ts`，无需用户手传 ai-flows 路径。

## 不做什么

- 不替用户改 `ai-review.config.json` 的凭据与远端配置（只检查、只指引）
- 不运行评审（那是 `ai-review run`）、不启动 serve / platform
- 不在非 git 目录安装

## 红线

- 目标必须是 git 仓库，否则立刻退出
- `ai-review.config.json` 已存在时一律跳过，绝不覆盖用户已有配置
- pre-push hook 已存在时备份再写，绝不静默覆盖
- 密钥无效时只**指引**用户重配，绝不猜测/伪造密钥，也不把密钥明文打印出来
