import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { z } from 'zod'
import { googleClient, saveAccount } from './accounts.ts'

export async function connectGmail(lifetime: AbortSignal) {
  const config = await googleClient()
  if (!config) throw new Error('Missing OAuth client')
  const credentials = { clientId: config.client_id, clientSecret: config.client_secret }
  const client = new OAuth2Client(credentials)
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const state = randomUUID()
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(180_000)])
  signal.throwIfAborted()
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback address')
    const host = `127.0.0.1:${address.port}`
    const redirect = `http://${host}/oauth2callback`
    const url = client.generateAuthUrl({
      redirect_uri: redirect, access_type: 'offline', prompt: 'select_account consent',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      state, code_challenge_method: CodeChallengeMethod.S256, code_challenge: codeChallenge,
    })
    signal.throwIfAborted()
    let consumed = false
    const done = new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      server.on('request', (req, res) => {
        const request = new URL(req.url ?? '/', redirect)
        if (consumed || req.method !== 'GET' || req.headers.host !== host || request.pathname !== '/oauth2callback'
          || request.searchParams.get('state') !== state) {
          res.writeHead(404).end()
          return
        }
        consumed = true
        const code = request.searchParams.get('code')
        res.writeHead(code ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        res.end(code ? '授权已返回，可以关闭此页并回到 DSH 查看结果。' : '授权未完成，请返回 DSH。')
        if (!code) { reject(new Error('Google consent declined')); return }
        server.close()
        void (async () => {
          const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirect })
          signal.throwIfAborted()
          if (!tokens.refresh_token) throw new Error('Missing refresh token')
          client.setCredentials(tokens)
          const profile = await client.request({
            url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', signal, timeout: 15_000,
          })
          const email = z.object({ emailAddress: z.email() }).parse(profile.data).emailAddress.toLowerCase()
          signal.throwIfAborted()
          await saveAccount({ provider: 'gmail', email, credentials: { ...credentials, refreshToken: tokens.refresh_token } })
        })().then(resolve, reject)
      })
    }).finally(() => { server.close(); server.closeAllConnections() })
    return { url, done }
  } catch (error) {
    server.close()
    throw error
  }
}
