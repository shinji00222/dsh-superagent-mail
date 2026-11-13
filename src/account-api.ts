import type { IncomingMessage, ServerResponse } from 'node:http'
import { accounts, googleClient, ICloudCredentials, removeAccount, saveAccount, saveGoogleClient } from './accounts.ts'
import { connectGmail } from './gmail-connect.ts'
import { openICloudInbox } from './mail-icloud.ts'
import type { PluginContext } from './host.ts'

export const API = '/superagent-mail/api'
async function body(req: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 32768) throw new Error('Invalid request')
    parts.push(bytes)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

export function registerAccounts(server: PluginContext['webServer']): () => void {
  if (server.host !== '127.0.0.1') return () => {}
  const lifetime = new AbortController()
  let pending: AbortController | undefined
  let status: 'idle' | 'waiting' | 'connected' | 'error' = 'idle'
  const unregister = server.register({ kind: 'prefix', path: API, async handler(req, res: ServerResponse) {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(JSON.stringify(data))
    }
    const host = req.headers.host
    if ((host !== `127.0.0.1:${server.port}` && host !== `localhost:${server.port}`)
      || req.headers['x-superagent-mail'] !== '1'
      || (req.headers.origin !== undefined && req.headers.origin !== `http://${host}`)) {
      send(403, { error: '需要从 DSH 邮箱面板操作。' })
      return
    }

    const route = `${req.method} ${new URL(req.url ?? '/', 'http://localhost').pathname.slice(API.length)}`
    let failure = '操作未完成，请重试。'
    try {
      switch (route) {
        case 'GET /accounts': {
          const [list, client] = await Promise.all([accounts(), googleClient()])
          send(200, { accounts: list.map(({ id, provider, email }) => ({ id, provider, email })), googleReady: !!client, status })
          return
        }
        case 'POST /google-client':
          failure = '请选择从 Google Cloud 下载的桌面 OAuth 客户端 JSON。'
          await saveGoogleClient(await body(req))
          break
        case 'POST /gmail': {
          failure = '无法启动 Google 授权，请检查 OAuth 客户端配置。'
          pending?.abort()
          const attempt = pending = new AbortController()
          status = 'waiting'
          try {
            const { url, done } = await connectGmail(AbortSignal.any([lifetime.signal, attempt.signal]))
            void done.then(
              () => { if (pending === attempt) status = 'connected' },
              () => { if (pending === attempt) status = 'error' },
            )
            send(200, { url })
          } catch (error) {
            if (pending === attempt) status = 'error'
            throw error
          }
          return
        }
        case 'POST /icloud': {
          failure = '无法登录 iCloud Mail。请核对邮箱地址、App 专用密码和网络。'
          const credentials = ICloudCredentials.parse(await body(req))
          await openICloudInbox(credentials, lifetime.signal, async () => {})
          lifetime.signal.throwIfAborted()
          await saveAccount({ provider: 'icloud', email: credentials.email, credentials })
          break
        }
        default: {
          const match = /^DELETE \/accounts\/([a-f0-9]{64})$/.exec(route)
          if (!match?.[1]) { send(404, { error: '操作不存在。' }); return }
          await removeAccount(match[1])
        }
      }
      send(200, {})
    } catch {
      send(400, { error: failure })
    }
  } })
  return () => { lifetime.abort(); unregister() }
}
