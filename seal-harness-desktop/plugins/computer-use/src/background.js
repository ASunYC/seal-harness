import { ComputerUseError } from './config.js'

export const readTools = new Set(['list_apps', 'list_windows', 'get_window_state', 'get_accessibility_tree', 'verify_state', 'zoom', 'get_screen_size', 'get_cursor_position', 'check_permissions', 'health_report'])
export const inputTools = new Set(['click', 'double_click', 'right_click', 'drag', 'scroll', 'type_text', 'press_key', 'hotkey', 'set_value'])
export const supportedTools = new Set([...readTools, ...inputTools])

/** 后台限制在执行边界强制实现，不能依赖模型遵守说明或Driver的建议升级。 */
export function backgroundArguments(name, raw, { label, local = true, protectedPid = process.pid } = {}) {
  if (!supportedTools.has(name)) throw new ComputerUseError('toolDenied', '此工具不属于后台电脑操作能力。')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ComputerUseError('invalidInput', '电脑操作参数必须是对象。')
  const args = { ...raw }
  if (['screenshot_out_file', 'output_file', 'output_path'].some(key => Object.hasOwn(args, key)))
    throw new ComputerUseError('fileOutputDenied', '观察结果必须回到当前会话，不接受写入截图文件的路径。')
  if (args.delivery_mode !== undefined && args.delivery_mode !== 'background') throw new ComputerUseError('foregroundDenied', '当前仅允许后台操作，不会切换到前台。')
  if (args.target && args.target.kind !== 'window' || args.scope && args.scope !== 'window') throw new ComputerUseError('desktopDenied', '只允许明确的应用窗口，不允许控制全局桌面或鼠标。')
  const windowScoped = inputTools.has(name) || ['get_window_state', 'verify_state', 'zoom'].includes(name)
  if (windowScoped) {
    const pid = args.target?.pid ?? args.pid, windowId = args.target?.window_id ?? args.window_id
    if (!Number.isSafeInteger(pid) || pid <= 0 || !(typeof windowId === 'number' && Number.isSafeInteger(windowId) && windowId >= 0 || typeof windowId === 'string' && windowId.length > 0))
      throw new ComputerUseError('windowRequired', '请先读取窗口列表，再指定准确的进程和窗口。')
    if (local && pid === protectedPid) throw new ComputerUseError('protectedHost', '不能通过电脑操作控制Seal自身。')
  }
  if (inputTools.has(name)) args.delivery_mode = 'background'
  if (label && Object.hasOwn(args, 'session')) args.session = label
  return args
}

export function publicToolSchema(tool) {
  const properties = { ...tool.inputSchema?.properties }
  delete properties.session
  delete properties.screenshot_out_file
  delete properties.output_file
  delete properties.output_path
  if (inputTools.has(tool.name) && properties.delivery_mode) properties.delivery_mode = { type: 'string', enum: ['background'], default: 'background', description: '仅后台交付，不支持时拒绝。' }
  return { ...tool.inputSchema, properties, ...(tool.inputSchema?.required ? { required: tool.inputSchema.required.filter(name => name !== 'session') } : {}) }
}
