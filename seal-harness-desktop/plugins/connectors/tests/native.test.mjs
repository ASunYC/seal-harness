import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as nativePlugin from '../src/native.js'
import { connectorCatalog } from '../../capability-shared/src/catalog.js'
import { parseConnectorCheck, trustedAuthorizationUrl } from '../../capability-shared/vendor/cc-haha/cliAdapter.ts'

test('official CLI checks retain vendor semantics and authorization URLs cannot switch suppliers', () => {
  assert.equal(parseConnectorCheck('feishu', { code: 0, stdout: JSON.stringify({ identity: 'user', verified: true }), stderr: '' }).authenticated, true)
  assert.equal(parseConnectorCheck('dingtalk', { code: 0, stdout: JSON.stringify({ success: true, authenticated: true }), stderr: '' }).authenticated, true)
  assert.equal(parseConnectorCheck('wecom', { code: 0, stdout: 'authorized', stderr: '' }).authenticated, true)
  assert(trustedAuthorizationUrl('feishu', 'https://accounts.feishu.cn/oauth/login'))
  assert.equal(trustedAuthorizationUrl('feishu', 'https://accounts.feishu.cn.evil.test/oauth'), undefined)
  assert.equal(trustedAuthorizationUrl('wecom', 'https://accounts.feishu.cn/oauth'), undefined)
})

test('native CLI tools use the ordinary DSH bridge with verified programs and structured arguments', async t => {
  const ctx = new Context(), calls = [], bytes = Buffer.from('verified fixture')
  await ctx.plugin(SystemPrompt).await(); await ctx.plugin(ToolRuntime).await()
  const native = { definition: connectorCatalog.find(item => item.id === 'feishu'), installation: { command: 'fixture.exe', env: {}, args: [] },
    dependencies: { platform: 'win32', arch: 'x64', readBinary: async () => bytes,
      binaryIntegrity: () => `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
      async run(command, args) { calls.push({ command, args }); return { code: 0, stdout: args.join(' '), stderr: '' } } } }
  await ctx.plugin(nativePlugin, { serverName: 'native', native }).await()
  t.after(() => ctx.fiber.dispose())
  const execute = args => ctx.tools.execute({ name: 'mcp__native__execute', callId: 'test', arguments: { args }, signal: new AbortController().signal })
  assert.equal((await execute(['docs', 'list'])).isError, false)
  assert.deepEqual(calls[0], { command: 'fixture.exe', args: ['docs', 'list'] })
  const help = await ctx.tools.execute({ name: 'mcp__native__help', callId: 'help', arguments: {}, signal: new AbortController().signal })
  assert.equal(help.isError, false)
  assert.deepEqual(calls[1].args, ['--help'])
  assert.equal((await execute(['auth', 'login'])).isError, true)
  assert.equal(calls.length, 2)
  native.dependencies.readBinary = async () => Buffer.from('tampered')
  assert.equal((await execute(['docs', 'list'])).isError, true)
  assert.equal(calls.length, 2)
})
