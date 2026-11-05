import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { blenderConfiguration, createBlenderIntegration, findUvx } from '../src/blender.js'

test('finds a real uvx file from a fixed user directory and rejects absent uvx', async () => {
  const home = process.cwd(), candidate = join(home, '.local', 'bin', 'uvx')
  const found = await findUvx({ home, platform: 'linux', environment: { PATH: '' }, stat: async path => {
    if (path !== candidate) throw new Error('missing')
    return { isFile: () => true, isSymbolicLink: () => false }
  } })
  assert.equal(found, candidate)
  await assert.rejects(findUvx({ home, platform: 'linux', environment: { PATH: '' }, stat: async () => { throw new Error('missing') } }), /未找到 uvx/)
})

test('prepares the official pinned addon before creating a disabled local MCP config', async () => {
  const calls = []
  const command = join(process.cwd(), 'tools', 'uvx')
  const integration = createBlenderIntegration({ locate: async () => command, run: async (...args) => { calls.push(args) } })
  const config = await integration.prepare(new AbortController().signal)
  assert.equal(calls[0][0], command)
  assert.deepEqual(calls[0][1], ['--python', '3.11', '--from', 'mcp-for-blender==2.2.6', 'mcp-for-blender', 'install-addon'])
  assert.equal(config.command, command)
  assert.equal(config.enabled, false)
  assert.equal(config.env.BLENDER_MCP_SAFE_MODE, '1')
  assert.deepEqual(config, blenderConfiguration(command))
  await assert.rejects(createBlenderIntegration({ locate: async () => command, run: async () => { throw new Error('network failure') } }).prepare(), /插件安装失败/)
})
