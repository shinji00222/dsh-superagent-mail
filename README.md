# DSH Superagent Mail

给 DeepSeek Harness Superagent 增加 Gmail 和 iCloud Mail 来源。收件按 Superagent 的接单规则评估，符合规则才建工单。Gmail 和 iCloud 各有一个「建单后自动处理」开关。

## 构建和安装

需要 Node.js 24+、pnpm 11 和 DSH 0.2.1 系列。先用新的 Web profile 验证。

```sh
pnpm install --frozen-lockfile
pnpm build
dsh --profile mail --from-default-profile web --dump-config
dsh plugin --profile mail add "file:$PWD"
```

第三条命令仅用于创建新 profile。PowerShell 中可用 `"file:$((Get-Location).Path)"`。DSH 桌面版也可在插件管理器添加构建好的本地包，可用 `pnpm pack` 打包。已有 Superagent 的 profile 要先移除原来的 `dsh-superagent` bundle，再装这一版，因为它们使用同一个 bundle 名称。安装前备份 profile 和状态目录。

在 profile 的 `cordis.patch.yml` 中设置一个绝对状态目录。新部署用空目录。

```yaml
- id: dsh-superagent
  config:
    stateDir: /absolute/path/to/superagent-mail-state
```

启动 profile 后，打开左侧 **Superagent**。只用邮箱时，在 **设置 → 来源** 关闭 GitHub，让运行时跳过仓库和 CLI 检查。

## 连接邮箱

凭据文件放在本地用户私有目录，填入 **设置 → 来源** 对应邮箱的「本地凭据文件路径」。使用绝对路径。

- **Gmail** 在 Google Cloud 启用 Gmail API，创建 Desktop OAuth 客户端并下载 JSON。若项目处于测试模式，将自己的 Google 账号加为测试用户。运行 `node scripts/gmail-auth.mjs <桌面客户端JSON> <新的本地凭据JSON>`，打开终端显示的链接，授权 `gmail.readonly`。脚本在本机写入 refresh token。外部测试应用的 refresh token 可能在 7 天后过期，届时重新授权。[Google 文档](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)
- **iCloud Mail** 在 Apple 账户启用双重认证并生成 App 专用密码。在本机创建 JSON，键为 `email`（完整 iCloud 邮箱地址）和 `appPassword`（App 专用密码）。插件通过 TLS 连接 `imap.mail.me.com:993`，以只读模式打开收件箱。[Apple 文档](https://support.apple.com/en-us/102525)

每个来源首次成功连接时记下进度，从那之后的新邮件开始。重启会从上次进度继续。Gmail 促销、垃圾箱、垃圾邮件，以及通过邮件头识别的群发和自动通知会被跳过。剩余邮件按接单规则评估。当前版本只读取收件箱，超过 512 KiB 的邮件会跳过，Worker 接收邮件的文本内容。

## 接单与派工

1. 在 **设置 → 评估 → 各来源**，把 Gmail 或 iCloud 收件箱的「名单外、未称呼」设置为「推断候选」。如果只想评估已知发件人，可用同页面的名单和「名单内、未称呼」。
2. 加一条适用于邮件的接单规则。例如「只接收明确要求执行、有清楚对象和范围的工作请求。广告、纯通知和未经授权的外部操作忽略。」选择评估模型。用「观察」核对判断，切到「自动」后通过评估的邮件会建单。
3. 每个来源的「建单后自动处理」默认关闭。关闭时，在工单详情点「开始处理」。开启时，新工单自动派给 Worker。已等待的工单仍需手动启动。

邮件会话用 Gmail thread ID 或 iCloud 邮件的回复链关联。邮件发件人地址用于分类，正文和邮件头是外部输入。邮件 Worker 使用 DSH 的 `workspace-write` 权限预设。邮件内容会进入本地工单和 DSH 模型请求。本版本通过面板查看结果，邮件来源使用只读权限，未实现自动回信。

Gmail 进度过期或 iCloud 收件箱 UIDVALIDITY 改变时，面板会报告收信失败。先查连接和授权。若确认要从现在重新开始，可用新的状态目录初始化来源，此操作会让新 profile 使用一套新的工单状态。

## 开发

```sh
pnpm typecheck
pnpm build
pnpm exec vitest run tests/mail.spec.ts tests/mail-providers.spec.ts tests/core-engine.spec.ts tests/stage.spec.ts
```

基于 [DeepSeek Superagent 原型](https://github.com/deepseek-ai/dsh-superagent-prototype) 和 [DSH Persona Routing](https://github.com/shinji00222/dsh-persona-routing)。保留原项目 MIT 许可和作者署名。Persona Router 仍可按原方式安装。
