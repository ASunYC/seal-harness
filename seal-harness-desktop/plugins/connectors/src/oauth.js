import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { auth } from '@modelcontextprotocol/client'
import { ConnectorError } from './schema.js'

function provider(state, redirectUrl, redirect, nonce) {
  return {
    redirectUrl,
    clientMetadata: { client_name: 'Seal Harness MCP Connector', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    state: () => nonce,
    clientInformation: () => state.clientInformation,
    saveClientInformation: value => { state.clientInformation = value },
    tokens: () => state.tokens,
    saveTokens: value => { state.tokens = value; state.expiresAt = value.expires_in ? Date.now() + value.expires_in * 1000 : undefined },
    redirectToAuthorization: redirect,
    saveCodeVerifier: value => { state.verifier = value },
    codeVerifier: () => state.verifier,
    saveDiscoveryState: value => { state.discovery = value },
    discoveryState: () => state.discovery,
    invalidateCredentials: scope => { if (scope === 'all' || scope === 'tokens') delete state.tokens; if (scope === 'all' || scope === 'client') delete state.clientInformation },
  }
}

export function createOAuth() {
  const pending = new Map()
  const cancel = id => { const item = pending.get(id); if (item) { clearTimeout(item.timeout); item.server.closeAllConnections(); item.server.close(); pending.delete(id) } }
  return {
    cancel,
    dispose: () => { for (const id of pending.keys()) cancel(id) },
    async refresh(entry, signal) {
      const state = structuredClone(entry.oauth)
      if (!state.tokens || !state.expiresAt || state.expiresAt > Date.now() + 30_000) return state
      if (!state.tokens.refresh_token) throw new ConnectorError('连接器授权已过期，请重新授权。')
      const result = await auth(provider(state, state.redirectUrl, () => { throw new ConnectorError('连接器需要重新授权。') }), { serverUrl: entry.url, scope: state.scopes?.join(' '), fetchFn: (url, options) => fetch(url, { ...options, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) })
      if (result !== 'AUTHORIZED') throw new ConnectorError('连接器需要重新授权。')
      return state
    },
    async begin(entry, commit, failed, signal) {
      cancel(entry.id)
      const nonce = randomUUID(), state = structuredClone(entry.oauth ?? {})
      delete state.tokens
      let authorizationUrl, client
      const server = createServer(async (request, response) => {
        const url = new URL(request.url, state.redirectUrl)
        if (url.pathname !== '/callback' || url.searchParams.get('state') !== nonce) { response.writeHead(400).end('Invalid authorization callback'); return }
        try {
          if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new ConnectorError('授权未完成，请重试。')
          const result = await auth(client, { serverUrl: entry.url, authorizationCode: url.searchParams.get('code'), ...(url.searchParams.has('iss') ? { iss: url.searchParams.get('iss') } : {}), fetchFn: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }) })
          if (result !== 'AUTHORIZED') throw new ConnectorError('授权未完成。')
          delete state.verifier
          await commit(state)
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<p>授权完成，可以关闭此页面并返回Seal Harness。</p>')
        } catch (error) {
          failed(error)
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end('<p>授权未完成，请返回Seal Harness重试。</p>')
        } finally { cancel(entry.id) }
      })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      state.redirectUrl = `http://127.0.0.1:${server.address().port}/callback`
      client = provider(state, state.redirectUrl, url => { authorizationUrl = url.toString() }, nonce)
      const timeout = setTimeout(() => { failed(new ConnectorError('授权等待超时，请重新授权。')); cancel(entry.id) }, 5 * 60_000)
      timeout.unref()
      pending.set(entry.id, { server, timeout })
      try {
        await auth(client, { serverUrl: entry.url, scope: state.scopes?.join(' '), fetchFn: (url, options) => fetch(url, { ...options, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }) })
        if (!authorizationUrl) throw new ConnectorError('服务未返回授权页面。')
        return { url: authorizationUrl }
      } catch { cancel(entry.id); throw new ConnectorError('无法发起 MCP 授权，请检查服务的 OAuth 配置。') }
    },
  }
}
