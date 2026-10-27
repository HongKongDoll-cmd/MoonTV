import { buildSearchQuery } from '../search-query';

describe('buildSearchQuery（4.7.0 标题含括号搜不到源站）', () => {
  test('剥掉半角年份括号', () => {
    expect(buildSearchQuery('沙丘 (2021)')).toBe('沙丘');
    expect(buildSearchQuery('Dune (2021)')).toBe('Dune');
  });

  test('剥掉全角括号与中文后缀', () => {
    expect(buildSearchQuery('进击的巨人（国语版）')).toBe('进击的巨人');
    expect(buildSearchQuery('某剧（第二季）')).toBe('某剧');
  });

  test('剥掉方括号与方头括号', () => {
    expect(buildSearchQuery('片名 [1080p]')).toBe('片名');
    expect(buildSearchQuery('片名【高清】')).toBe('片名');
  });

  test('多个括号连续出现都能剥掉', () => {
    expect(buildSearchQuery('片名 (2020) [HD] 【中字】')).toBe('片名');
  });

  test('嵌套括号只留主标题', () => {
    expect(buildSearchQuery('片名 (A (B))')).toBe('片名');
    expect(buildSearchQuery('片名（译名（台湾））')).toBe('片名');
  });

  test('括号不成对时原样返回（不吞掉后半截）', () => {
    expect(buildSearchQuery('片名(x')).toBe('片名(x');
    expect(buildSearchQuery('片名)后')).toBe('片名)后');
  });

  test('纯括号标题回退为原串（不能搜成空）', () => {
    expect(buildSearchQuery('(2021)')).toBe('(2021)');
    expect(buildSearchQuery('【预告】')).toBe('【预告】');
  });

  test('不含括号的标题不被改动', () => {
    expect(buildSearchQuery('三体')).toBe('三体');
    expect(buildSearchQuery('The Matrix')).toBe('The Matrix');
  });

  test('剥掉括号后残留的分隔符被清掉', () => {
    expect(buildSearchQuery('片名 · (2020)')).toBe('片名');
    expect(buildSearchQuery('片名 / (2020)')).toBe('片名');
    expect(buildSearchQuery('片名 - (2020)')).toBe('片名');
  });

  test('空值与空白安全返回空串', () => {
    expect(buildSearchQuery('')).toBe('');
    expect(buildSearchQuery('   ')).toBe('');
    expect(buildSearchQuery(null)).toBe('');
    expect(buildSearchQuery(undefined)).toBe('');
  });

  test('不修改入参（纯函数）', () => {
    const title = '沙丘 (2021)';
    buildSearchQuery(title);
    expect(title).toBe('沙丘 (2021)');
  });
});
