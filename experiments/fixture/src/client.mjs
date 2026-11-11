/**
 * Minimal HTTP JSON client used by the fixture service.
 *
 * Today every failure is final: the caller sees the first error, including a transient 503 or a
 * reset connection. The implement task adds bounded exponential-backoff retries here.
 */

/** Resolve after `ms` milliseconds; rejects with an AbortError when `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError(signal)); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(abortError(signal)) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const abortError = (signal) => signal?.reason ?? new DOMException('Aborted', 'AbortError')

/** True for a transient network failure or an HTTP status that is worth retrying. */
export function isTransient(error) {
  const status = error?.status
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up/i.test(String(error?.message ?? error))
}

/** One attempt: fetch a URL, require a 2xx, parse JSON. */
async function attempt(url, { fetchImpl, signal, timeoutMs }) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} for ${url}`)
      error.status = response.status
      throw error
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Fetch a URL and parse its JSON body.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} [options]
 */
export async function fetchJson(url, { fetchImpl = fetch, signal, timeoutMs = 5000 } = {}) {
  return attempt(url, { fetchImpl, signal, timeoutMs })
}
