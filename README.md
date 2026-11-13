# DSH Superagent Mail

给现有 Superagent 添加 **Gmail** 和 **iCloud Mail** 两个来源。它通过 Superagent 的来源接口提交邮件事件，沿用宿主的评估、工单和 Worker。

## 安装

需要 DSH 0.2.1 系列，以及已经安装并完成部署检查的 Superagent。使用 Node.js 24 和 pnpm 11.7 构建。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

在 DSH 桌面版的 **插件 → 添加插件** 里选择生成的 `dsh-superagent-mail-0.5.0.tgz` 本地安装包。如果使用 CLI，把包添加到已有 Superagent 的同一个 profile，例如 `dsh plugin --profile desktop add <安装包绝对路径>`。如果面板没刷新，重新打开 DSH。

## 连接邮箱

在 DSH 桌面侧栏打开 **邮箱账号 → 添加邮箱**。可重复添加多个 Gmail 和 iCloud Mail，面板会列出已连接账号。每个邮箱独立记录收信进度。

- **Gmail** 点「连接 Gmail」，在系统浏览器选择账号并同意只读授权，回到 DSH 查看结果。使用自有 Google Cloud 项目时，先启用 Gmail API、创建 Desktop OAuth 客户端，再在面板选「导入并连接 Gmail」，导入下载的 JSON。后续添加账号直接点「连接 Gmail」。如果 OAuth 应用处于 External / Testing，Google 会在七天后让刷新令牌过期。[Google 桌面授权文档](https://developers.google.com/identity/protocols/oauth2/native-app)
- **iCloud Mail** 填邮箱地址和 Apple App 专用密码，点「验证并添加」。插件通过 TLS 连接 `imap.mail.me.com:993`，以只读模式打开收件箱。[Apple App 专用密码](https://support.apple.com/en-us/102654)

部署者也可以用 `DSH_MAIL_GOOGLE_CLIENT_ID` 和 `DSH_MAIL_GOOGLE_CLIENT_SECRET` 为插件预配 OAuth 客户端。独立安装包需要导入或预配客户端。授权资料保存在运行 DSH 的本机用户目录，面板只显示账号地址。此前配置的「本地凭据文件路径」仍可使用。

首次成功连接会记录当前收信进度，之后只读新收件。重启从上次进度继续。插件会跳过垃圾邮件、Gmail 促销标签，以及用邮件头识别出的群发和自动通知。超过 512 KiB 的邮件跳过，处理范围为邮件文本。邮件正文可进入 Superagent 的本地记录和模型请求。结果在面板里查看。

## 接单规则

1. 在 **设置 → 评估 → 各来源**，将 Gmail 或 iCloud 收件箱的「名单外、未称呼」设为「推断候选」。也可以仅评估名单内的发件人。
2. 添加接单规则，例如「接收有明确待办、对象和范围的工作请求。忽略广告、纯通知和超出授权范围的操作。」
3. 先用宿主的「观察」模式检查评估结果。切到「自动」后，宿主会为通过评估的请求建单并派工。

派工和部署检查由宿主控制。原版 Superagent 没有对来源开放「建单后自动处理」开关，启动仍可能要求配置 GitHub 仓库。这个插件使用宿主现有的接单模式。邮箱发件人地址只作为评估信息，邮件来源不提供回信能力。

## 开发

运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。来源接口参考 [DeepSeek Superagent 的 Source Cookbook](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md)。
