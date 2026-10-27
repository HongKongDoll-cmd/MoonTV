/**
 * 鉴权路径规则（middleware matcher 的唯一真源）。
 *
 * 单独抽出来是为了能被单测覆盖：middleware.ts 顶部 import 了 `next/server`，
 * 在 Jest 的 jsdom 沙箱里会因缺少 Request 全局而直接报错，导致 matcher
 * 根本没法测。而 matcher 写错是**静默**的 —— 少排一个路径会让整个接口
 * 免登录（安全事故），多排一个（比如把探针路由排掉）会让修复悄悄失效。
 */

/**
 * 需要走鉴权的路径（排除静态资源、登录页与少数公开接口）。
 *
 * ⚠️ `/api/auth-check` **不能**出现在排除列表里：登录页靠它判断
 * 「Set-Cookie 是否真的落地」，一旦被放行就永远返回 200，形同没有。
 */
export const AUTH_MATCHER =
  '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/tvbox/config|api/tvbox/categories|api/douban/recommends|api/admin/tvbox|api/m3u8|api/image-proxy).*)';

/** 判断某个 pathname 是否需要通过 middleware 鉴权 */
export function needsAuth(pathname: string): boolean {
  return new RegExp(`^${AUTH_MATCHER}$`).test(pathname);
}
