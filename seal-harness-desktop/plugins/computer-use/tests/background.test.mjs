import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { backgroundArguments, publicToolSchema } from '../src/background.js'
import { mountComputerScope } from '../src/bridge.js'

const window = { target: { kind: 'window', pid: 100, window_id: 22 } }

test('strict background guard refuses foreground, desktop, app launch, raw cursor and missing windows before delivery', () => {
  const args = backgroundArguments('click', { ...window, element_token: 'current', capture_id: 'fresh' })
  assert.equal(args.delivery_mode, 'background'); assert.equal(args.capture_id, 'fresh')
  for (const name of ['bring_to_front', 'launch_app', 'move_cursor', 'mouse_button_down', 'run_steps', 'run_script', 'clipboard_write', 'get_desktop_state'])
    assert.throws(() => backgroundArguments(name, window), { code: 'toolDenied' }, name)
  assert.throws(() => backgroundArguments('click', { ...window, delivery_mode: 'foreground' }), { code: 'foregroundDenied' })
  assert.throws(() => backgroundArguments('type_text', { target: { kind: 'desktop' }, text: 'no' }), { code: 'desktopDenied' })
  assert.throws(() => backgroundArguments('press_key', { key: 'enter' }), { code: 'windowRequired' })
  assert.throws(() => backgroundArguments('get_window_state', { ...window, screenshot_out_file: 'C:\\outside\\capture.png' }), { code: 'fileOutputDenied' })
  assert.throws(() => backgroundArguments('get_window_state', { ...window, output_file: '/outside/capture.png' }), { code: 'fileOutputDenied' })
  assert.throws(() => backgroundArguments('zoom', { ...window, output_path: '' }), { code: 'fileOutputDenied' }, 'even an empty output field must not reach Driver')
  assert.throws(() => backgroundArguments('set_value', { pid: process.pid, window_id: 1, value: 'no' }), { code: 'protectedHost' })
  assert.equal(backgroundArguments('set_value', { pid: process.pid, window_id: 1, value: 'VM allowed' }, { local: false }).delivery_mode, 'background')
  const raw = { name: 'click', inputSchema: { type: 'object', properties: { delivery_mode: { type: 'string' }, session: { type: 'string' }, screenshot_out_file: { type: 'string' }, output_file: { type: 'string' }, output_path: { type: 'string' } }, required: ['session'] } }
  const schema = publicToolSchema(raw)
  assert.deepEqual(schema.properties.delivery_mode.enum, ['background']); assert.equal(Object.hasOwn(schema.properties, 'session'), false)
  assert.deepEqual(schema.required, []); assert.ok(raw.inputSchema.properties.session, 'schema projection must not mutate discovery input')
  assert.equal(['screenshot_out_file', 'output_file', 'output_path'].some(key => Object.hasOwn(schema.properties, key)), false)
})

test('real Cordis scoped bridge keeps images native, isolates tools, and never dispatches denied foreground input', async t => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await(); await ctx.plugin(ToolRuntime).await()
  const saved = []
  ctx.provide('attachments', { async saveImages(images) {
    saved.push(...images)
    return images.map(input => ({ attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: input.mediaType, bytes: input.data.byteLength, width: 1, height: 1 }))
  } })
  ctx.provide('llm', { async resolveModelInfo() { return { inputModalities: ['text', 'image'] } } })
  t.after(() => ctx.fiber.dispose())
  const agent = { id: 'computer-agent', session: { requestHeader: () => ({ config: { provider: 'fixture', model: 'vision' } }) } }, other = { id: 'other-agent' }
  agent.ctx = createScope(ctx, agent).ctx; other.ctx = createScope(ctx, other).ctx
  const calls = [], image = { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
  let active = true
  const tools = ['get_window_state', 'click', 'bring_to_front', 'launch_app'].map(name => ({ name, description: name,
    inputSchema: { type: 'object', properties: { pid: { type: 'integer' }, window_id: { type: 'integer' }, session: { type: 'string' }, delivery_mode: { type: 'string' } }, additionalProperties: false } }))
  const scope = await mountComputerScope(agent, { profile: { mode: 'local', name: '本机' }, label: 'owned-session',
    connection: { async listTools() { return tools } }, assertActive() { if (!active) throw new Error('stopped') },
    async call(name, args) { calls.push({ name, args }); return { content: [image, { type: 'text', text: 'real readback' }] } },
  })
  t.after(() => scope.dispose())
  assert.deepEqual(ctx.tools.schemas(agent).filter(item => item.name.startsWith('mcp__seal_computer__')).map(item => item.name).sort(), ['mcp__seal_computer__click', 'mcp__seal_computer__get_window_state'])
  assert.equal(ctx.tools.schemas(other).some(item => item.name.startsWith('mcp__seal_computer__')), false)
  const execute = (name, args, target = agent) => ctx.tools.execute({ name: `mcp__seal_computer__${name}`, arguments: args, agent: target, callId: `${name}-${calls.length}`, signal: new AbortController().signal })
  const observed = await execute('get_window_state', { pid: 100, window_id: 22 })
  assert.equal(observed.isError, false)
  assert.ok(observed.content.some(item => item.type === 'image'), 'MCP image must survive native DSH output projection')
  assert.equal(saved.length, 1); assert.equal(saved[0].mediaType, image.mimeType)
  assert.equal(saved[0].data.toString('base64'), image.data)
  assert.equal(calls[0].args.session, 'owned-session')
  assert.equal((await execute('click', { pid: 100, window_id: 22, delivery_mode: 'foreground' })).isError, true)
  assert.equal(calls.length, 1)
  assert.equal((await execute('click', { pid: 100, window_id: 22 }, other)).isError, true)
  assert.equal(calls.length, 1)
  assert.equal((await execute('click', { pid: 100, window_id: 22 })).isError, false)
  assert.equal(calls[1].args.delivery_mode, 'background')
  active = false
  assert.equal((await execute('get_window_state', { pid: 100, window_id: 22 })).isError, true)
  assert.equal(calls.length, 2)
  await scope.dispose()
  assert.equal(ctx.tools.schemas(agent).some(item => item.name.startsWith('mcp__seal_computer__')), false)
})
