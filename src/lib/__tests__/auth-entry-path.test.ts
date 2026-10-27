import { isAuthEntryPath } from '../auth-matcher';

/**
 * 4.6.8：这条判断是「登录页无限刷新」的止血点。
 *
 * 入口页上挂载的全局组件（设置同步 / 更新通知 / 在线状态）同样会带鉴权请求，
 * 未登录时必然 401。若 401 处理继续执行「logout + 跳 /login?redirect=当前页」，
 * 就会 /login → /login?redirect=/login → … 无限套娃。
 */
describe('isAuthEntryPath', () => {
  test('登录页本身返回 true（含查询串被剥离后的形态）', () => {
    expect(isAuthEntryPath('/login')).toBe(true);
    expect(isAuthEntryPath('/login/')).toBe(true);
    expect(isAuthEntryPath('/login/verify')).toBe(true);
  });

  test('警告页也算入口页', () => {
    expect(isAuthEntryPath('/warning')).toBe(true);
    expect(isAuthEntryPath('/warning/')).toBe(true);
  });

  test('前缀相似的其他路径不算（避免误判导致该跳不跳）', () => {
    expect(isAuthEntryPath('/loginx')).toBe(false);
    expect(isAuthEntryPath('/loginfoo/bar')).toBe(false);
    expect(isAuthEntryPath('/warning-list')).toBe(false);
  });

  test('业务页面不算', () => {
    expect(isAuthEntryPath('/')).toBe(false);
    expect(isAuthEntryPath('/play/123')).toBe(false);
    expect(isAuthEntryPath('/search')).toBe(false);
  });

  test('登录相关 API 不算（API 的 401 应走接口自己的处理）', () => {
    expect(isAuthEntryPath('/api/login')).toBe(false);
    expect(isAuthEntryPath('/api/auth-check')).toBe(false);
  });
});
