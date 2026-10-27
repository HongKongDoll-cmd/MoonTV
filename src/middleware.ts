/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // 如果没有设置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage模式：在middleware中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return NextResponse.next();
  }

  // 其他模式：只验证签名
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifySignature(
      authInfo.username,
      authInfo.signature,
      process.env.PASSWORD || ''
    );

    // 签名验证通过即可
    if (isValidSignature) {
      return NextResponse.next();
    }
  }

  // 签名验证失败或不存在签名
  return handleAuthFailure(request, pathname);
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    const unauthorized = new NextResponse('Unauthorized', { status: 401 });
    clearInvalidAuthCookie(unauthorized);
    return unauthorized;
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  const response = NextResponse.redirect(loginUrl);

  /**
   * 关键（4.6.7）：**清掉那份被判定无效的 auth cookie**。
   *
   * 不清的话它会一直挂在浏览器上，每次请求都被带上、每次都被拒 ——
   * 于是「访问首页 → 踢回 /login → 登录页加载 → 跳首页 → 再被踢回」
   * 无限往返，用户看到的就是「卡在登录界面一直重复刷新」。
   *
   * 典型触发场景：手机上残留了旧版本/旧端口/旧 path 写下的 auth cookie，
   * 解析失败但浏览器照发；或者密码改过之后旧签名失效。
   * 桌面端往往因为 cookie 状态干净而不复现。
   */
  clearInvalidAuthCookie(response);

  return response;
}

/**
 * 清掉被判定无效的 auth cookie（4.6.7）。
 *
 * 不清的话它会一直挂在浏览器上、每次请求都被带上、每次都被拒 ——
 * 「访问首页 → 踢回 /login → 登录页跳首页 → 再被踢回」无限往返，
 * 用户看到的就是「卡在登录界面一直重复刷新」。
 * 典型触发：手机上残留旧版本/旧端口写下的 auth cookie（解析失败但仍被发送），
 * 或改过密码后旧签名失效。桌面端常因 cookie 干净而不复现。
 */
function clearInvalidAuthCookie(response: NextResponse): void {
  response.cookies.set('auth', '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    sameSite: 'lax',
    httpOnly: false,
    secure: false,
  });
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/m3u8',
    '/api/image-proxy',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

/**
 * 配置 middleware 匹配规则。
 *
 * ⚠️ **必须写成字面量**：Next 用 AST 静态分析提取 `config`，写成变量引用
 * 会导致 matcher 失效或构建报错。
 * 规则语义的真源在 `src/lib/auth-matcher.ts`（便于单测），
 * 两处由 `src/lib/__tests__/auth-matcher.test.ts` 比对源码保证不漂移。
 * 改这里时同步改那边，否则测试会红。
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/tvbox/config|api/tvbox/categories|api/douban/recommends|api/admin/tvbox|api/m3u8|api/image-proxy).*)',
  ],
};
