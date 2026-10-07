import { createHash } from 'node:crypto'
import { callDecisionModel, DecisionError, PROVIDERS, REGIONS, validateWorkspaceId } from './decision.js'

const key = 'dsh-plugin-ask-jev/decision-settings'
const defaults = () => ({ provider: 'jev', region: 'cn-beijing', workspaceId: '', keys: {} })
const emptyState = () => ({ version: 1, accounts: {} })

function storedState(record) {
  if (record === undefined) return emptyState()
  const state = record.kind === 'grant' ? record.payload : null
  if (state?.version !== 1 || !state.accounts || typeof state.accounts !== 'object' || Array.isArray(state.accounts))
    throw new DecisionError('invalidStorage', '决策插件的凭据记录无效。')
  return state
}

function publicStatus(settings) {
  return {
    provider: settings.provider,
    region: settings.region,
    workspaceId: settings.workspaceId,
    configured: { jev: Boolean(settings.keys?.jev), alibaba: Boolean(settings.keys?.alibaba && settings.workspaceId) },
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, value]) => [id, { label: value.label, model: value.model }])),
    regions: REGIONS,
  }
}

function cleanKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value))
    throw new DecisionError('invalidKey', 'API Key 格式无效。')
  return value.trim()
}

/** API Keys live in Host credentials; Client only receives configured flags. */
export function createDecisionService({ credentials, identity = () => undefined, fetchImpl = fetch }) {
  if (!credentials?.readRecord || !credentials?.modifyRecord) throw new DecisionError('unavailable', 'DSH 凭据服务未加载。')

  async function owner() {
    const auth = identity()
    if (!auth) return 'desktop'
    const session = await auth.getSession()
    if (!session?.accountId) throw new DecisionError('notSignedIn', '请先登录本机账号。')
    return createHash('sha256').update(String(session.accountId)).digest('hex')
  }

  async function settingsFor(account) {
    const state = storedState(await credentials.readRecord(key))
    return { ...defaults(), ...state.accounts[account], keys: { ...state.accounts[account]?.keys } }
  }

  return Object.freeze({
    async status() { return publicStatus(await settingsFor(await owner())) },
    async configure(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DecisionError('invalidInput', '配置格式无效。')
      const account = await owner()
      const saved = await credentials.modifyRecord(key, record => {
        const state = storedState(record)
        const previous = { ...defaults(), ...state.accounts[account], keys: { ...state.accounts[account]?.keys } }
        const provider = input.provider ?? previous.provider
        if (!Object.hasOwn(PROVIDERS, provider)) throw new DecisionError('invalidProvider', '请选择 Jev 或阿里百炼。')
        const region = input.region ?? previous.region
        if (!Object.hasOwn(REGIONS, region)) throw new DecisionError('invalidRegion', '请选择百炼支持的地域。')
        if (input.workspaceId !== undefined && typeof input.workspaceId !== 'string')
          throw new DecisionError('invalidWorkspace', '业务空间 ID 格式无效。')
        const workspaceId = input.workspaceId === undefined ? previous.workspaceId : input.workspaceId.trim()
        if (workspaceId) validateWorkspaceId(workspaceId)
        const keys = { ...previous.keys }
        if (input.apiKey !== undefined) keys[provider] = cleanKey(input.apiKey)
        if (input.clearKey === true) delete keys[provider]
        return { kind: 'grant', payload: { version: 1, accounts: { ...state.accounts,
          [account]: { provider, region, workspaceId, keys } } } }
      })
      return publicStatus({ ...defaults(), ...storedState(saved).accounts[account] })
    },
    async decide(input, signal) {
      const account = await owner()
      const settings = await settingsFor(account)
      const result = await callDecisionModel({ provider: settings.provider, settings, input,
        key: settings.keys[settings.provider], fetchImpl, signal })
      if (await owner() !== account) throw new DecisionError('identityChanged', '当前账号已变化，请重新提交。')
      return result
    },
  })
}
