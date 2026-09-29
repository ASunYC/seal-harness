/**
 * 交给系统打开的外部链接判定（安全编码规范 1.6 乙档）：全局导航拦截、各窗口的 window.open 处理器、
 * 流水线链接、本机流程实例页、能力仓库的文档链接与第三方授权页共用这一份；证据外链在自有文法层之前
 * 用 `isPermittedExternalLink` 先判原始输入。
 *
 * `shell.openExternal` 会把地址交给系统上注册的**任意**协议处理程序——`ms-settings:`、
 * `smb:`、`file:` 这类地址由系统直接拉起对应程序，中间没有浏览器的任何提示。因此：
 * - 只放行 `http:` / `https:`，调用方只能收窄、不能放宽；
 * - 地址里有空白、控制字符或不可见字符（零宽、双向覆盖、变体选择符）一律拒绝——解析器会
 *   悄悄吞掉其中一部分，界面上看到的地址与实际打开的地址就对不上；
 * - 带用户名或口令的地址拒绝（`https://可信域名@他处/` 是冒充形态）；
 * - 放行时交出解析后的规范化地址，原始字符串不再往下传。
 *
 * 与 `infra/safeExternalUrl.ts` 的分工（ADR-0041 两档）：那边是甲档，服务本产品自身的登录与统一认证
 * 授权地址，仅 https 且拒内网主机；这里是乙档，面向用户主动打开的链接与第三方授权页，允许 http 与内网主机。
 */

export type ExternalLinkProtocol = 'http:' | 'https:';

type ExternalLinkRejection =
  'whitespaceOrControl' | 'unparseable' | 'protocolNotAllowed' | 'credentials';

type ExternalLinkDecision =
  | { readonly allowed: true; readonly url: string }
  | { readonly allowed: false; readonly reason: ExternalLinkRejection };

const WEB_LINK_PROTOCOLS: readonly ExternalLinkProtocol[] = ['http:', 'https:'];
const UNSAFE_LINK_CHARACTER = /[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const LEADING_SCHEME = /^([a-z][a-z0-9+.-]*):/iu;
/**
 * 日志里的协议只记这几个分类，其余一律记 `other`：协议串同样来自不可信地址，
 * 冒号前可以是任意文本，原样写进日志就是在记用户正文。
 */
const LOGGED_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'file',
  'javascript',
  'data',
  'mailto',
]);

/**
 * 判定通过才交给 `open`，打开成功返回 true；判定不过或打开失败都记一条元数据日志并返回 false，
 * 不向调用方抛出——`void` 调用点因此不会留下未处理的拒绝。
 * 日志只含协议分类与原因，**不含地址本身**（地址可能带令牌、路径与查询词）。
 */
export async function openPermittedExternalLink(
  value: string,
  open: (url: string) => Promise<unknown>,
  protocols: readonly ExternalLinkProtocol[] = WEB_LINK_PROTOCOLS,
): Promise<boolean> {
  const decision = decideExternalLink(value, protocols);
  if (!decision.allowed) {
    console.warn(
      `[external-link] blocked protocol=${loggedScheme(value)} reason=${decision.reason}`,
    );
    return false;
  }
  try {
    await open(decision.url);
    return true;
  } catch {
    // 系统给的错误文案可能夹带地址：只记协议分类，不记错误对象。
    console.warn(`[external-link] open failed protocol=${loggedScheme(value)}`);
    return false;
  }
}

/**
 * 只判不开：给自有判定链、要把乙档判定叠在前面判原始输入的出口用（证据外链，ADR-0041）。
 * 与 `openPermittedExternalLink` 同一份判定；不记日志，被拒后怎么回应由调用方决定。
 */
export function isPermittedExternalLink(
  value: string,
  protocols: readonly ExternalLinkProtocol[] = WEB_LINK_PROTOCOLS,
): boolean {
  return decideExternalLink(value, protocols).allowed;
}

function decideExternalLink(
  value: string,
  protocols: readonly ExternalLinkProtocol[],
): ExternalLinkDecision {
  if (UNSAFE_LINK_CHARACTER.test(value)) return { allowed: false, reason: 'whitespaceOrControl' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { allowed: false, reason: 'unparseable' };
  }
  if (!protocols.some((protocol) => protocol === url.protocol)) {
    return { allowed: false, reason: 'protocolNotAllowed' };
  }
  if (url.username !== '' || url.password !== '') return { allowed: false, reason: 'credentials' };
  return { allowed: true, url: url.href };
}

function loggedScheme(value: string): string {
  const scheme = LEADING_SCHEME.exec(value)?.[1]?.toLowerCase();
  return scheme !== undefined && LOGGED_SCHEMES.has(scheme) ? scheme : 'other';
}
