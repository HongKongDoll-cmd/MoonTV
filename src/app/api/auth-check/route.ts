import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * 登录态探测（4.6.7）。
 *
 * **本路由故意不加入 middleware 的排除列表**：
 * 能执行到这里的请求说明已通过鉴权；未登录或 cookie 无效的请求
 * 会在 middleware 里被直接拦成 401（并顺手清掉无效 cookie）。
 *
 * 登录页在跳转前请求它一次，用来确认「Set-Cookie 真的落地了」。
 * 手机浏览器禁用 Cookie / 无痕模式时这里会返回 401，登录页就能
 * 给出明确提示，而不是跳转 → 被踢回 → 再跳转的无限循环。
 *
 * 不复用 /api/user-settings 的原因：它要求 cookie 里带 username，
 * 而 localstorage 模式登录只写 password（不写 username），
 * 拿它做探测会把正常登录全部误判为失败。
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
