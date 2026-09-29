export const AUTONOMOUS_REMOTE_ERROR_MESSAGES = {
    remoteAuthenticationFailed: 'SSH 认证失败，请检查用户名或密码。',
    remoteHandshakeRejected: '固定主机已接受网络连接，但 SSH 服务在认证前主动断开。系统已自动重试，无需重新输入密码；请联系主机管理员检查 SSH 服务、连接限流或安全策略。',
    remoteConnectionTimeout: '连接固定主机超时，系统已自动重试；请确认主机在线且 SSH 端口可访问。',
    remoteConnectionRefused: '固定主机拒绝 SSH 连接，系统已自动重试；请确认 SSH 服务已启动且端口配置正确。',
    remoteHostUnreachable: '当前网络无法到达固定主机，系统已自动重试；请确认主机地址和网络路由。',
    remoteConnectionFailed: '无法连接固定主机，系统已自动重试；请检查主机地址、SSH 端口和网络。',
    remotePrivilegeUnavailable: 'SSH 登录成功，但该账号无法使用 sudo。请确认账号具有 sudo 权限，且 SSH 密码同时可用于 sudo。',
    remoteDirectoryUnavailable: '已连接固定主机，但无法准备受控部署目录。请检查账号 sudo 权限及 /opt 目录状态。',
    remoteDeployFailed: '固定主机部署脚本未完成，请根据失败阶段检查服务器环境后重试。',
    remoteImageLockUnavailable: '固定主机已完成部署，但镜像版本锁读取失败，请刷新状态后重试。',
    remoteActionFailed: '固定主机实例操作未完成，请刷新状态后重试。',
    registryCredentialUnavailable: '工作台暂时无法取得镜像仓库凭据，请重新登录后重试。',
    modelUnavailable: '所选模型无法导出到固定主机。请检查模型连接、API Key 和服务地址，或选择“稍后配置”。',
    'invalid deploy asset path': '固定主机发布资源清单无效，请修复应用安装后重试。',
    'deploy asset digest mismatch': '固定主机发布资源校验失败，请修复应用安装后重试。',
};
export function autonomousRemoteFailureMessage(error) {
    const code = error instanceof Error ? error.message : String(error);
    return AUTONOMOUS_REMOTE_ERROR_MESSAGES[code];
}
