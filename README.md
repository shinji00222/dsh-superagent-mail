# DSH Superagent Mail

给现有 Superagent 添加 **Gmail** 和 **iCloud Mail** 两个来源。它通过 Superagent 的来源接口提交邮件事件，沿用宿主的评估、工单和 Worker。

## 安装

需要 DSH 0.2.1 系列，以及已经安装并完成部署检查的 Superagent。使用 Node.js 24 和 pnpm 11.7 构建。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

在 DSH 桌面版的 **插件 → 添加插件** 里选择生成的 `dsh-superagent-mail-0.4.0.tgz` 本地安装包。如果使用 CLI，把包添加到已有 Superagent 的同一个 profile，例如 `dsh plugin --profile desktop add <安装包绝对路径>`。如果面板没刷新，重新打开 DSH。

## 连接邮箱

打开 **Superagent → 设置 → 来源**，启用 Gmail 或 iCloud Mail，在「本地凭据文件路径」填入对应文件的绝对路径。凭据放在你自己的私有目录。

- **Gmail** 在 Google Cloud 启用 Gmail API，创建 Desktop OAuth 客户端并下载 JSON。若应用处于测试模式，把自己的账号加为测试用户。运行 `node scripts/gmail-auth.mjs <桌面客户端JSON> <新的本地凭据JSON>`，打开终端显示的链接并授权 `gmail.readonly`。输出文件就是凭据文件。[Google 文档](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)
- **iCloud Mail** 在 Apple 账户生成 App 专用密码。在本机创建一个 JSON，键为 `email`（完整邮箱地址）和 `appPassword`（App 专用密码）。插件通过 TLS 连接 `imap.mail.me.com:993`，以只读模式打开收件箱。[Apple 文档](https://support.apple.com/en-us/102525)

首次成功连接会记录当前收信进度，之后只读新收件。重启从上次进度继续。插件会跳过垃圾邮件、Gmail 促销标签，以及用邮件头识别出的群发和自动通知。超过 512 KiB 的邮件跳过，处理范围为邮件文本。邮件正文可进入 Superagent 的本地记录和模型请求。结果在面板里查看。

## 接单规则

1. 在 **设置 → 评估 → 各来源**，将 Gmail 或 iCloud 收件箱的「名单外、未称呼」设为「推断候选」。也可以仅评估名单内的发件人。
2. 添加接单规则，例如「接收有明确待办、对象和范围的工作请求。忽略广告、纯通知和超出授权范围的操作。」
3. 先用宿主的「观察」模式检查评估结果。切到「自动」后，宿主会为通过评估的请求建单并派工。

派工和部署检查由宿主控制。原版 Superagent 没有对来源开放「建单后自动处理」开关，启动仍可能要求配置 GitHub 仓库。这个插件使用宿主现有的接单模式。邮箱发件人地址只作为评估信息，邮件来源不提供回信能力。

## 开发

运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。来源接口参考 [DeepSeek Superagent 的 Source Cookbook](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md)。
