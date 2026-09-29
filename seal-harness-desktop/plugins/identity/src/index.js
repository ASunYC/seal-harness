import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { loadServices, servicesSchema } from './services.js'
import { IdentityError, IdentityProvider } from './provider.js'
import { IdentitySession } from './session.js'
import { IdentitySso } from './sso.js'
import { IdentityWecom } from './wecom.js'
import { accountHomeKey } from './account-home.js'

export const name = 'seal-harness-identity'
export const inject = ['connection', 'credentials']
export const Config = z.strictObject({ services: servicesSchema.default({}) }).default({ services: {} })

export async function apply(ctx, config = {}) {
  const runtime = ctx.get('desktopRuntime')
  const scope = runtime?.identityHomeStatus ? await runtime.identityHomeStatus() : { enabled: false, key: null }
  const home = scope.enabled ? scope.baseHome : resolveDshHome(process.env.DSH_HOME || join(homedir(), '.seal-harness'))
  const services = await loadServices({ home, services: config.services })
  const provider = new IdentityProvider(services.getConfig().identityBaseUrl)
  const inCurrentHome = user => !scope.enabled || scope.key === accountHomeKey(provider.baseUrl, user.id)
  const identity = new IdentitySession({ provider, credentials: ctx.credentials, logger: ctx.logger, canPersist: inCurrentHome })
  await identity.initialize()
  if (scope.enabled) {
    try {
      const handoff = await runtime.takeIdentityHandoff()
      if (handoff) {
        if (handoff.baseUrl !== provider.baseUrl || scope.key !== accountHomeKey(provider.baseUrl, handoff.userId)
          || handoff.session?.user?.id !== handoff.userId) throw new IdentityError('invalidCallback')
        const generation = await identity.beginExternalLogin()
        await identity.acceptExternalSession(handoff.session, handoff.remember === true, generation)
      }
    } catch { ctx.logger?.warn('登录交接无效或已过期，请重新登录。') }
  }
  let switchTask = null
  let switchError = null
  const switchHome = () => {
    const user = identity.getStatus().user
    if (!scope.enabled || !user || inCurrentHome(user) || switchTask) return switchTask
    switchTask = runtime.switchIdentityHome(accountHomeKey(provider.baseUrl, user.id), {
      baseUrl: provider.baseUrl, userId: user.id, session: identity.exportHandoff(), remember: identity.getRemember(),
    }).catch(async () => {
      switchTask = null
      switchError = new IdentityError('homeSwitchFailed')
      await identity.logout().catch(() => {})
      throw switchError
    })
    return switchTask
  }
  ctx.effect(() => identity.subscribe(() => { void switchHome()?.catch(() => ctx.logger?.warn('账号 Home 切换失败，请重新登录。')) }), 'seal-harness-identity: account home')
  const visibleStatus = value => {
    if (!value?.user || inCurrentHome(value.user)) return value
    return { ...value, user: null, accountId: null, switchingHome: true }
  }
  const browser = runtime?.protocolScheme && runtime.openExternal && runtime.onProtocolUrl ? {
    returnUri: `${runtime.protocolScheme}://auth/netauth/callback`,
    openExternal: url => runtime.openExternal(url), onCallback: listener => runtime.onProtocolUrl(listener),
  } : undefined
  const sso = new IdentitySso({ provider, identity, browser })
  const wecom = new IdentityWecom({ provider, identity, runtime })
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort(); sso.cancel(); wecom.cancel(); identity.dispose() }, 'seal-harness-identity: lifetime')
  ctx.provide('sealHarnessServices', services)
  ctx.provide('sealHarnessIdentity', identity)
  if (browser) ctx.effect(() => browser.onCallback(url => sso.callback(url).catch(() => ctx.logger?.warn('统一认证回跳未完成，请重新登录。'))), 'seal-harness-identity: callback')
  const empty = z.strictObject({})
  const handlers = {
    status: input => { empty.parse(input); return { ...visibleStatus(identity.getStatus()), services: services.getDiagnostics(), sso: sso.getStatus(), wecom: wecom.getStatus(),
      ...(switchError ? { homeSwitchError: switchError.message } : {}),
      needsAccountLogin: Boolean(scope.enabled && scope.key && !identity.getStatus().user) } },
    availability: async (input, signal) => {
      empty.parse(input)
      const [server, ssoStatus, wecomStatus] = await Promise.all([provider.checkAvailability(signal), sso.refreshAvailability(signal), wecom.refreshAvailability(signal)])
      return { server, sso: ssoStatus, wecom: wecomStatus }
    },
    offline: async input => {
      empty.parse(input)
      if (!scope.enabled || scope.key === null) return { switchingHome: false }
      await runtime.switchIdentityHome(null)
      return { switchingHome: true }
    },
    login: async (input, signal) => { sso.cancel(); wecom.cancel(); switchError = null; const value = await identity.login(input, signal); if (switchTask) await switchTask; if (switchError) throw switchError; return visibleStatus(value) },
    restore: async (input, signal) => { empty.parse(input); sso.cancel(); wecom.cancel(); switchError = null; const value = await identity.restore(signal); if (switchTask) await switchTask; if (switchError) throw switchError; return visibleStatus(value) },
    me: async (input, signal) => { empty.parse(input); return visibleStatus(await identity.me(signal)) },
    refresh: async input => { empty.parse(input); await identity.refreshSession(); return visibleStatus(identity.getStatus()) },
    logout: async input => { empty.parse(input); sso.cancel(); wecom.cancel(); const value = await identity.logout(); if (scope.enabled && scope.key !== null) await runtime.switchIdentityHome(null); return value },
    'password/change': (input, signal) => identity.changePassword(input, signal),
    'sso/start': input => { wecom.cancel(); return sso.start(z.strictObject({ remember: z.boolean().default(true) }).parse(input)) },
    'sso/remember': input => sso.setRemember(z.strictObject({ remember: z.boolean() }).parse(input).remember),
    'sso/cancel': input => { empty.parse(input); sso.cancel(); return sso.getStatus() },
    'wecom/start': input => { sso.cancel(); return wecom.start(z.strictObject({ remember: z.boolean().default(true), embedded: z.boolean().default(true) }).parse(input)) },
    'wecom/remember': input => wecom.setRemember(z.strictObject({ remember: z.boolean() }).parse(input).remember),
    'wecom/cancel': input => { empty.parse(input); wecom.cancel(); return wecom.getStatus() },
  }
  for (const [action, handler] of Object.entries(handlers)) {
    const endpoint = `seal-harness-identity/${action}`
    ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', async fetch(request) {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return new Response('Expected JSON', { status: 415 })
      let message
      try { message = clientRequestSchema.parse(await request.json()) } catch { return new Response('Invalid RPC request', { status: 400 }) }
      if (message.method !== endpoint) return new Response('Invalid RPC method', { status: 400 })
      let result
      try { result = { ok: true, value: await handler(message.payload ?? {}, AbortSignal.any([request.signal, lifetime.signal])) } }
      catch (error) {
        const safe = error instanceof IdentityError ? error : new IdentityError(error instanceof z.ZodError ? 'invalidInput' : 'unreachable')
        result = { ok: false, error: { code: safe.code, message: safe.message } }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    } })
  }
}
