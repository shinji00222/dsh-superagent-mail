import { useEffect, useState, type FormEvent } from 'react'

const id = 'dsh-superagent-mail'
const title = '邮箱账号'
type Account = { id: string; email: string; provider: 'gmail' | 'icloud' }
type State = { accounts: Account[]; googleReady: boolean; status: 'idle' | 'waiting' | 'connected' | 'error' }
type Slots = { inject(slot: string, register: () => unknown): void; register(options: object, component: () => JSX.Element): unknown }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/superagent-mail/api' + path, {
    method, headers: { 'x-superagent-mail': '1', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error)
  return value as T
}

function MailAccounts() {
  const [state, setState] = useState<State>()
  const [form, setForm] = useState<'choose' | 'icloud'>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [oauthUrl, setOauthUrl] = useState('')
  const waiting = state?.status === 'waiting'
  useEffect(() => {
    let live = true
    const load = () => request<State>('/accounts').then(value => { if (live) setState(value) },
      () => { if (live) setError('无法读取邮箱账号。请检查插件是否已经加载。') })
    void load()
    const timer = waiting ? window.setInterval(load, 1500) : undefined
    return () => { live = false; window.clearInterval(timer) }
  }, [waiting])

  async function action(task: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await task()
      setState(await request<State>('/accounts'))
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
    } finally {
      setBusy(false)
    }
  }

  function startGoogle(client?: File) {
    setOauthUrl('')
    void action(async () => {
      if (client) await request('/google-client', 'POST', JSON.parse(await client.text()))
      const { url } = await request<{ url: string }>('/gmail', 'POST')
      setOauthUrl(url)
      window.open(url, '_blank', 'noopener,noreferrer')
      setForm(undefined)
    })
  }

  function addICloud(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void action(async () => {
      await request('/icloud', 'POST', { email: data.get('email'), appPassword: data.get('appPassword') })
      setForm(undefined)
    })
  }

  return <main style={{ maxWidth: 680, margin: '32px auto', padding: '0 24px', colorScheme: 'light dark' }}>
    <h1>{title}</h1>
    <button disabled={busy || !state} onClick={() => setForm('choose')}>添加邮箱</button>
    {form === 'choose' && <div style={{ marginBlock: 16 }}>
      <button disabled={busy || !state?.googleReady} onClick={() => startGoogle()}>连接 Gmail</button>{' '}
      <button disabled={busy} onClick={() => setForm('icloud')}>连接 iCloud Mail</button>{' '}
      <button disabled={busy} onClick={() => setForm(undefined)}>取消</button>
      {!state?.googleReady && <p>
        首次连接 Gmail 需要导入 Google Cloud 的桌面 OAuth 客户端文件。
        {' '}<a href="https://developers.google.com/workspace/gmail/api/quickstart/nodejs" target="_blank" rel="noreferrer">创建步骤</a>{' '}
        <label>导入并连接 Gmail <input type="file" accept=".json,application/json" disabled={busy}
          onChange={event => { const file = event.currentTarget.files?.[0]; if (file) startGoogle(file) }} /></label>
      </p>}
    </div>}
    {form === 'icloud' && <form onSubmit={addICloud} style={{ display: 'grid', gap: 12, marginBlock: 16, maxWidth: 420 }}>
      <label>iCloud 邮箱 <input name="email" type="email" autoComplete="username" required /></label>
      <label>App 专用密码 <input name="appPassword" type="password" autoComplete="off" required /></label>
      <a href="https://support.apple.com/en-us/102654" target="_blank" rel="noreferrer">生成 Apple App 专用密码</a>
      <div><button disabled={busy}>验证并添加</button>{' '}<button type="button" disabled={busy} onClick={() => setForm(undefined)}>取消</button></div>
    </form>}
    {waiting && <p role="status">等待 Google 授权。{oauthUrl && <> <a href={oauthUrl} target="_blank" rel="noreferrer">打开授权页面</a></>}</p>}
    {state?.status === 'error' && <p role="status">Gmail 授权未完成。请检查 Google 授权状态后重试。</p>}
    {error && <p role="alert">{error}</p>}
    {state?.accounts.length ? <ul style={{ padding: 0, listStyle: 'none' }}>
      {state.accounts.map(account => <li key={account.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBlock: 12 }}>
        <span>{account.email} · {account.provider === 'gmail' ? 'Gmail' : 'iCloud Mail'}</span>
        <button disabled={busy} aria-label={`移除 ${account.email}`} onClick={() => void action(() =>
          request('/accounts/' + account.id, 'DELETE'))}>移除</button>
      </li>)}
    </ul> : state && <p>还没有添加邮箱。</p>}
    <p>收信状态和接单规则在 Superagent 的「来源」与「评估」中查看。</p>
  </main>
}

export const inject = ['slots']
export function apply(ctx: { slots: Slots }) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: id, inject: () => ({}) }, MailAccounts))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id, order: 11, label: () => title,
  }, () => <span aria-hidden="true">✉</span>))
}
