/**
 * `library-sort` 单测。
 *
 * 重点是两条**刻意保留**的规则：
 *   1. 目录永远在文件前面（升降序只翻转组内部）；
 *   2. 缺 `modified` 的条目恒排最后（不能退化成 1970 年）。
 * 以及名称排序的自然序（S01E02 要在 S01E10 前面，字符串比较会反过来）。
 */

import {
  compareLibraryItems,
  DEFAULT_LIBRARY_SORT,
  LIBRARY_SORT_KEY,
  normalizeLibrarySort,
  parseLibrarySort,
  parseModifiedTime,
  serializeLibrarySort,
  sortLibraryItems,
} from '../library-sort';

const dir = (name: string) => ({ name, is_dir: true, size: 0 });
const file = (name: string, size: number, modified?: string) => ({
  name,
  is_dir: false,
  size,
  modified,
});

const names = (items: Array<{ name: string }>) => items.map((i) => i.name);

describe('parseModifiedTime', () => {
  it('ISO 字符串解析成时间戳', () => {
    const t = parseModifiedTime('2024-05-01T12:00:00+08:00');
    expect(typeof t).toBe('number');
    expect(t).toBe(Date.parse('2024-05-01T12:00:00+08:00'));
  });

  it('缺失 / 空串 / 非法一律 null（不是 0）', () => {
    expect(parseModifiedTime(undefined)).toBeNull();
    expect(parseModifiedTime('')).toBeNull();
    expect(parseModifiedTime('   ')).toBeNull();
    expect(parseModifiedTime('昨天')).toBeNull();
    expect(parseModifiedTime(123)).toBeNull();
  });
});

describe('parseLibrarySort / serializeLibrarySort', () => {
  it('往返一致', () => {
    const sort = { field: 'size', order: 'desc' } as const;
    expect(parseLibrarySort(serializeLibrarySort(sort))).toEqual(sort);
  });

  it('脏值返回 null', () => {
    expect(parseLibrarySort('')).toBeNull();
    expect(parseLibrarySort('name')).toBeNull();
    expect(parseLibrarySort('name:up')).toBeNull();
    expect(parseLibrarySort('title:asc')).toBeNull();
    expect(parseLibrarySort(null)).toBeNull();
    expect(parseLibrarySort(123)).toBeNull();
  });
});

describe('normalizeLibrarySort', () => {
  it('认对象也认字符串', () => {
    expect(normalizeLibrarySort({ field: 'time', order: 'desc' })).toEqual({
      field: 'time',
      order: 'desc',
    });
    expect(normalizeLibrarySort('size:desc')).toEqual({
      field: 'size',
      order: 'desc',
    });
  });

  it('脏值退回默认（名称升序）', () => {
    expect(normalizeLibrarySort('nonsense')).toEqual(DEFAULT_LIBRARY_SORT);
    expect(normalizeLibrarySort({ field: 'name' })).toEqual(DEFAULT_LIBRARY_SORT);
    expect(normalizeLibrarySort(null)).toEqual(DEFAULT_LIBRARY_SORT);
    expect(normalizeLibrarySort(undefined)).toEqual(DEFAULT_LIBRARY_SORT);
  });
});

describe('sortLibraryItems — 名称', () => {
  const items = [
    file('S01E10.mkv', 1),
    file('S01E02.mkv', 1),
    file('S01E01.mkv', 1),
  ];

  it('自然序：E02 在 E10 前面（字符串比较会反过来）', () => {
    expect(names(sortLibraryItems(items, { field: 'name', order: 'asc' }))).toEqual([
      'S01E01.mkv',
      'S01E02.mkv',
      'S01E10.mkv',
    ]);
  });

  it('降序整体翻转', () => {
    expect(names(sortLibraryItems(items, { field: 'name', order: 'desc' }))).toEqual([
      'S01E10.mkv',
      'S01E02.mkv',
      'S01E01.mkv',
    ]);
  });
});

describe('sortLibraryItems — 大小', () => {
  const items = [file('a.mkv', 100), file('c.mkv', 300), file('b.mkv', 200)];

  it('升序 / 降序', () => {
    expect(names(sortLibraryItems(items, { field: 'size', order: 'asc' }))).toEqual([
      'a.mkv',
      'b.mkv',
      'c.mkv',
    ]);
    expect(names(sortLibraryItems(items, { field: 'size', order: 'desc' }))).toEqual([
      'c.mkv',
      'b.mkv',
      'a.mkv',
    ]);
  });

  it('大小相同按名称兜底（顺序稳定）', () => {
    const same = [file('b.mkv', 100), file('a.mkv', 100), file('c.mkv', 100)];
    expect(names(sortLibraryItems(same, { field: 'size', order: 'asc' }))).toEqual([
      'a.mkv',
      'b.mkv',
      'c.mkv',
    ]);
    expect(names(sortLibraryItems(same, { field: 'size', order: 'desc' }))).toEqual([
      'a.mkv',
      'b.mkv',
      'c.mkv',
    ]);
  });

  it('size 缺失按 0 算，不抛错', () => {
    const weird = [{ name: 'x.mkv', is_dir: false }, file('y.mkv', 5)] as never[];
    expect(names(sortLibraryItems(weird, { field: 'size', order: 'asc' }))).toEqual([
      'x.mkv',
      'y.mkv',
    ]);
  });
});

describe('sortLibraryItems — 时间', () => {
  const items = [
    file('old.mkv', 1, '2020-01-01T00:00:00Z'),
    file('new.mkv', 1, '2024-01-01T00:00:00Z'),
    file('mid.mkv', 1, '2022-01-01T00:00:00Z'),
  ];

  it('升序最旧在前 / 降序最新在前', () => {
    expect(names(sortLibraryItems(items, { field: 'time', order: 'asc' }))).toEqual([
      'old.mkv',
      'mid.mkv',
      'new.mkv',
    ]);
    expect(names(sortLibraryItems(items, { field: 'time', order: 'desc' }))).toEqual([
      'new.mkv',
      'mid.mkv',
      'old.mkv',
    ]);
  });

  it('缺 modified 的条目两个方向都排最后', () => {
    const withMissing = [...items, file('unknown.mkv', 1)];
    expect(
      names(sortLibraryItems(withMissing, { field: 'time', order: 'asc' })).at(-1)
    ).toBe('unknown.mkv');
    expect(
      names(sortLibraryItems(withMissing, { field: 'time', order: 'desc' })).at(-1)
    ).toBe('unknown.mkv');
  });

  it('全是缺时间的条目 → 退回名称序', () => {
    const none = [file('b.mkv', 1), file('a.mkv', 1)];
    expect(names(sortLibraryItems(none, { field: 'time', order: 'desc' }))).toEqual([
      'a.mkv',
      'b.mkv',
    ]);
  });
});

describe('sortLibraryItems — 目录优先与不变性', () => {
  const items = [
    file('a.mkv', 999),
    dir('剧集'),
    file('b.mkv', 1),
    dir('电影'),
  ];

  it('目录恒在前，升降序都不变', () => {
    const asc = sortLibraryItems(items, { field: 'size', order: 'asc' });
    const desc = sortLibraryItems(items, { field: 'size', order: 'desc' });
    expect(asc.slice(0, 2).map((i) => i.is_dir)).toEqual([true, true]);
    expect(desc.slice(0, 2).map((i) => i.is_dir)).toEqual([true, true]);
    // 目录大小都是 0 → 目录组内部按名称兜底，两个方向一致
    expect(names(asc).slice(0, 2)).toEqual(names(desc).slice(0, 2));
    // 文件组内部按大小：升序小在前，降序大在前
    expect(names(asc).slice(2)).toEqual(['b.mkv', 'a.mkv']);
    expect(names(desc).slice(2)).toEqual(['a.mkv', 'b.mkv']);
  });

  it('compareLibraryItems 直接判目录优先', () => {
    expect(compareLibraryItems(dir('a'), file('b', 1))).toBeLessThan(0);
    expect(compareLibraryItems(file('b', 1), dir('a'))).toBeGreaterThan(0);
  });

  it('不改原数组；空输入返回空数组', () => {
    const original = [file('b.mkv', 2), file('a.mkv', 1)];
    const sorted = sortLibraryItems(original, { field: 'name', order: 'asc' });
    expect(names(original)).toEqual(['b.mkv', 'a.mkv']); // 原数组不动
    expect(names(sorted)).toEqual(['a.mkv', 'b.mkv']);
    expect(sortLibraryItems(null)).toEqual([]);
    expect(sortLibraryItems(undefined)).toEqual([]);
  });

  it('默认排序 = 名称升序', () => {
    expect(names(sortLibraryItems([file('b', 1), file('a', 1)]))).toEqual(['a', 'b']);
  });
});

describe('存储键', () => {
  it('键名稳定（改了会让所有人的偏好失效）', () => {
    expect(LIBRARY_SORT_KEY).toBe('moontv_library_sort');
  });
});
