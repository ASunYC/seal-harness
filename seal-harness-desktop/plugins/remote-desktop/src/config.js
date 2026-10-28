import { isIP } from 'node:net'
import { posix, win32 } from 'node:path'
import { z } from 'zod'

export class RemoteHostError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const absolutePath = z.string().max(2048).default('').refine(value => !/[\x00-\x1f\x7f]/.test(value) &&
  (!value || posix.isAbsolute(value) || win32.isAbsolute(value)), '请填写绝对文件路径。')
const hostname = z.string().trim().min(1).max(253).refine(value => Boolean(isIP(value)) ||
  value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)), '请填写主机名或IP，不含协议和端口。')
export const hostConfig = z.strictObject({
  protocol: z.enum(['ssh', 'rdp', 'vnc']), host: hostname, port: z.number().int().min(1).max(65535),
  username: z.string().trim().max(128).regex(/^[\p{L}\p{N}_.@\\-]*$/u, '用户名含不支持的字符。').default(''),
  identityFile: absolutePath, clientPath: absolutePath,
}).superRefine((config, ctx) => {
  if (config.protocol !== 'ssh' && config.identityFile) ctx.addIssue({ code: 'custom', message: '私钥文件仅用于SSH。', path: ['identityFile'] })
  if (config.protocol === 'vnc' && config.username) ctx.addIssue({ code: 'custom', message: 'VNC用户名在客户端填写。', path: ['username'] })
})
export const hostId = z.string().uuid()
export const idInput = z.strictObject({ id: hostId })
export const saveInput = z.strictObject({ id: hostId.optional(), name: z.string().trim().min(1).max(100), config: hostConfig })
