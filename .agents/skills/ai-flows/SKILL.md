---
name: ai-flows
description: ai-flows 能力总入口，只做目录与路由，不承载业务细节。按用户意图把 agent 引导到对应业务文档——仓库初始化与密钥检查、Python 代码评审、ai-review 评审链用法。用户说「初始化仓库」「接入评审」「检查密钥」「代码评审」「跑评审」时使用。
---

# ai-flows 能力索引

本文件是**唯一入口**，只负责判断意图并指向业务文档。**业务细节一律不在本文件展开。**

## ERROR约束（先读，必须遵守）

- **只读需求的文档**：每轮对话只允许读取与当前意图匹配的**相关需求**业务文档；其余业务文档严禁打开、严禁 `Grep`、严禁凭印象引用。
- **按需下钻**：业务文档内部若再指向支撑文件（如 `references/reviewers/` 下的规则子文档），由该业务文档自己决定是否读取，主文档不管，也不能提前读。
- **意图不明先问用户**，不要为了“了解全貌”把所有业务文档读一遍。
- **不越界**：用户没提的业务，不读、不做、不提示。

## 业务路由表

| 用户意图 / 触发词 | 只读这个业务文档 | 配套脚本 |
|---|---|---|
| 初始化仓库、接入评审、装 ai-review、给仓库配评审、检查/重配模型密钥、私有仓库推送凭据 | `references/repository-manager/init.md` | `<skill-dir>/scripts/init-repo.mjs`、`<skill-dir>/scripts/check-key.mjs`、`<skill-dir>/scripts/check-remote-auth.mjs` |
| 代码评审、按规范评审代码、Python 规范检查 | `references/reviewers/CODE-REVIEW.MD` | — |
| 跑评审、起报告服务、起平台、装 hook、ai-review CLI 用法、评审输出规范化 | `references/ai-flows/review-chain.md` | `<skill-dir>/scripts/normalize-review.mjs` |

## 读取方式

`<skill-dir>` = 本 `SKILL.md` 所在目录（`…/.agents/skills/ai-flows`）。

1. 按路由表确定当前需求对应的业务文档。
2. **只** Read 该行对应的业务文档。
3. 按业务文档的指引执行（脚本一律用 `<skill-dir>/scripts/` 下的相对路径）。

## 目录结构

```
ai-flows/
├── SKILL.md                              # 本文件：唯一入口，纯路由
├── references/
│   ├── repository-manager/init.md        # 仓库初始化 + 密钥检查业务
│   ├── reviewers/CODE-REVIEW.MD          # Python 代码评审业务（+ 规则子文档 *.md）
│   └── ai-flows/review-chain.md          # ai-review 评审链用法业务
├── log/code-review/                      # 评审日志（时间戳命名，已 gitignore）
└── scripts/
    ├── init-repo.mjs                     # 拷贝 config + 装 pre-push hook
    ├── check-key.mjs                     # 校验模型密钥有效性
    ├── check-remote-auth.mjs             # 推送前置检查（远端认证 + 凭据泄露）
    └── normalize-review.mjs              # 评审输出ERROR归一（不靠 prompt）
```

## 红线

- 只读当前意图对应的业务文档，多读即违规
- 本文件不写任何命令细节与业务规则（细节都在业务文档里）
- 不在主文档层代替业务文档执行操作
