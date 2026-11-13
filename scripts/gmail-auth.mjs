import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { OAuth2Client } from 'google-auth-library'

const [clientFile, outputFile] = process.argv.slice(2)
if (!clientFile || !outputFile) {
  console.error('Usage: node scripts/gmail-auth.mjs <desktop-client.json> <new-local-credentials.json>')
  process.exit(1)
}

try {
  const { installed } = JSON.parse(await readFile(clientFile, 'utf8'))
  if (!installed?.client_id || !installed.client_secret) throw new Error('Expected a Desktop OAuth client')
  const { client_id: clientId, client_secret: clientSecret } = installed
  const client = new OAuth2Client({ clientId, clientSecret })
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const state = crypto.randomUUID()
  const server = createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Authorization timed out')), 180_000)
      server.on('request', (req, res) => {
        const url = new URL(req.url, redirectUri)
        if (url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== state) {
          res.writeHead(404).end()
          return
        }
        clearTimeout(timeout)
        const value = url.searchParams.get('code')
        res.writeHead(value ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(value ? 'Authorization received. Return to the terminal to finish.' : 'Authorization was declined.')
        if (value) resolve(value)
        else reject(new Error('Authorization declined'))
      })
      console.log('Open the following URL in your browser to authorize Gmail read access:')
      console.log(client.generateAuthUrl({
        redirect_uri: redirectUri, access_type: 'offline', prompt: 'consent', state,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        code_challenge_method: 'S256', code_challenge: codeChallenge,
      }))
    })
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri })
    if (!tokens.refresh_token) throw new Error('Google did not issue a refresh token')
    await writeFile(outputFile, JSON.stringify({ clientId, clientSecret, refreshToken: tokens.refresh_token }) + '\n',
      { flag: 'wx', mode: 0o600 })
    console.log('Credentials file created. Enter its absolute path in the Gmail Source settings.')
  } finally {
    server.close()
  }
} catch {
  console.error('Gmail authorization failed. Check the Desktop OAuth client, test-user access, and output path.')
  process.exitCode = 1
}
