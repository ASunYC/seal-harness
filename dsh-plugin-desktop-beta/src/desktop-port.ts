/** Shared Desktop Web port policy. */

/** Fixed starting port used when the user has not configured a port. */
export const DESKTOP_DEFAULT_WEB_PORT = 43_120

/** Maximum number of sequential ports tried after a real bind collision. */
export const DESKTOP_WEB_PORT_RETRY_LIMIT = 32

/** 桌面只能使用已绑定的实际端口，不能把未就绪状态拼进 URL 或代理配置。 */
export function requireDesktopWebPort(port: number | undefined): number {
  if (port === undefined) throw new Error('dsh-plugin-desktop: WebServer has not bound a port')
  return port
}
