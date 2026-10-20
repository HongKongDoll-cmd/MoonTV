import { changelog } from '@/lib/changelog';
import { CURRENT_VERSION } from '@/lib/version';

/**
 * 4.6.4：版本号曾与更新日志脱节（changelog 已到 4.6.3，version.ts 还写死 4.6.2），
 * 登录页 / 用户菜单 / 版本面板三处都显示旧号。现在版本号从 changelog 首条读取，
 * 用这条测试把这个关系锁住：**更新日志第一条必须等于当前版本号**。
 */
describe('版本号与更新日志同步', () => {
  test('CURRENT_VERSION 等于更新日志的首条版本', () => {
    expect(changelog.length).toBeGreaterThan(0);
    expect(CURRENT_VERSION).toBe(changelog[0].version);
  });

  test('版本号是 x.y.z 三段式', () => {
    expect(CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('更新日志按版本号严格降序排列', () => {
    const toTuple = (v: string) => v.split('.').map((n) => Number(n));
    for (let i = 1; i < changelog.length; i++) {
      const prev = toTuple(changelog[i - 1].version);
      const cur = toTuple(changelog[i].version);
      expect(cur[0]).toBeLessThanOrEqual(prev[0]);
      if (cur[0] === prev[0]) {
        expect(cur[1]).toBeLessThanOrEqual(prev[1]);
        if (cur[1] === prev[1]) {
          expect(cur[2]).toBeLessThan(prev[2]);
        }
      }
    }
  });

  test('每条都有日期，且日期格式合法', () => {
    for (const entry of changelog) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
