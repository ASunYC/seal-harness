import { isIP } from 'node:net'
import { posix, win32 } from 'node:path'
import { z } from 'zod'

export class ComputerUseError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const filePath = z.string().max(2048).default('').refine(value => !/[\x00-\x1f\x7f]/.test(value) && (!value || posix.isAbsolute(value) || win32.isAbsolute(value)), '请填写绝对文件路径。')
const remotePath = z.string().max(2048).default('').refine(value => !/[\x00-\x1f\x7f]/.test(value) && (!value || value === 'cua-driver' || value === 'cua-driver.exe' || posix.isAbsolute(value) || win32.isAbsolute(value)), '驱动路径必须为绝对路径或 cua-driver。')
const validHost = value => Boolean(isIP(value)) || value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
export const profileSchema = z.strictObject({
  id: z.union([z.literal('local'), z.string().uuid()]).optional(),
  name: z.string().trim().min(1).max(100), mode: z.enum(['local', 'vm']),
  driverPath: remotePath, guestOS: z.enum(['linux', 'win32', 'darwin']).default('linux'),
  host: z.string().trim().max(253).default(''), port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().max(128).regex(/^[a-z0-9_.@\\-]*$/i).default(''),
  identityFile: filePath, socket: z.string().max(2048).default('').refine(value => !/[\x00-\x1f\x7f]/.test(value)),
}).superRefine((profile, ctx) => {
  if (profile.mode === 'local') {
    if (profile.id && profile.id !== 'local') ctx.addIssue({ code: 'custom', message: '本机标识必须为 local。', path: ['id'] })
    if (profile.driverPath && !posix.isAbsolute(profile.driverPath) && !win32.isAbsolute(profile.driverPath)) ctx.addIssue({ code: 'custom', message: '本机驱动必须为绝对文件路径。', path: ['driverPath'] })
    if (profile.host || profile.username || profile.identityFile || profile.socket) ctx.addIssue({ code: 'custom', message: '本机模式不接受远端连接参数。' })
  } else {
    if (profile.id === 'local') ctx.addIssue({ code: 'custom', message: '虚拟机不能使用本机标识。', path: ['id'] })
    if (!profile.host || !validHost(profile.host)) ctx.addIssue({ code: 'custom', message: '请填写虚拟机 IP 或主机名，不含协议和端口。', path: ['host'] })
    if (profile.guestOS === 'win32' && profile.socket && !profile.socket.startsWith('\\\\.\\pipe\\')) ctx.addIssue({ code: 'custom', message: 'Windows 来宾必须使用交互桌面驱动的命名管道。', path: ['socket'] })
    if (profile.guestOS !== 'win32' && profile.socket && !posix.isAbsolute(profile.socket)) ctx.addIssue({ code: 'custom', message: '来宾 socket 必须为绝对路径。', path: ['socket'] })
  }
})
export const localProfile = Object.freeze({ id: 'local', name: '本机', mode: 'local', driverPath: '', guestOS: ['win32', 'darwin', 'linux'].includes(process.platform) ? process.platform : 'linux', host: '', port: 22, username: '', identityFile: '', socket: '' })
