import { readFileSync } from 'fs';
import { join } from 'path';

import { AUTH_MATCHER, needsAuth } from '../auth-matcher';

describe('needsAuth（middleware matcher 单一真源）', () => {
  test('/api/auth-check 必须受保护（登录态探针）', () => {
    // 这条最关键：一旦它被放行，探针就永远返回 200，
    // 登录页面对「cookie 没存住」的判断会静默失效。
    expect(needsAuth('/api/auth-check')).toBe(true);
    expect(AUTH_MATCHER).not.toContain('api/auth-check');
  });

  test('业务页面与受保护接口都需要鉴权', () => {
    expect(needsAuth('/')).toBe(true);
    expect(needsAuth('/play/123')).toBe(true);
    expect(needsAuth('/search?q=x')).toBe(true);
    expect(needsAuth('/api/user-settings')).toBe(true);
    expect(needsAuth('/api/favorites')).toBe(true);
  });

  test('登录页与警告页放行（否则会互相重定向成死循环）', () => {
    expect(needsAuth('/login')).toBe(false);
    expect(needsAuth('/login?redirect=/play')).toBe(false);
    expect(needsAuth('/warning')).toBe(false);
  });

  test('登录/注册/登出接口放行', () => {
    expect(needsAuth('/api/login')).toBe(false);
    expect(needsAuth('/api/register')).toBe(false);
    expect(needsAuth('/api/logout')).toBe(false);
  });

  test('静态资源与公开图片接口放行', () => {
    expect(needsAuth('/_next/static/chunks/a.js')).toBe(false);
    expect(needsAuth('/_next/image?url=x')).toBe(false);
    expect(needsAuth('/favicon.ico')).toBe(false);
    expect(needsAuth('/api/image-proxy?url=x')).toBe(false);
    expect(needsAuth('/api/m3u8?url=x')).toBe(false);
  });

  test('抽出来的 matcher 与原配置等价（防止搬家时改坏）', () => {
    expect(AUTH_MATCHER.startsWith('/(')).toBe(true);
    expect(AUTH_MATCHER).toContain('_next/static');
    expect(AUTH_MATCHER).toContain('api/image-proxy');
  });

  test('middleware.ts 里的字面量与本文件的规则一致（防两份漂移）', () => {
    // Next 要求 matcher 必须是字面量（AST 静态提取），无法直接引用变量，
    // 所以 middleware.ts 里必然有一份副本。这条测试读源码比对，
    // 任何一边改了而另一边没改，都会立刻失败。
    const middlewareSource = readFileSync(
      join(process.cwd(), 'src/middleware.ts'),
      'utf8'
    );
    expect(middlewareSource).toContain(AUTH_MATCHER);
  });
});
