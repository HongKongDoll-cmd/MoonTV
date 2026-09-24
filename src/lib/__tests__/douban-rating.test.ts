/**
 * `douban-rating` 单测。
 *
 * 覆盖的是「批量补全评分」这条链路的纯逻辑：归一化评分值、从详情响应里取值、
 * 收集待查 id、清洗外部输入、把评分合并回条目。
 *
 * 重点验证两件事：
 * 1. **没开分必须归一成空字符串**（0 / null / "0" 都不能显示成 0.0）；
 * 2. **合并时没有变化要返回原数组引用**，否则调用方会无谓 setState 触发重渲染。
 */

import {
  collectRateLookupIds,
  extractDoubanSubjectRate,
  isDoubanSubjectId,
  mergeDoubanRates,
  normalizeDoubanRate,
  normalizeRateLookupIds,
  RATE_LOOKUP_LIMIT,
} from '../douban-rating';

describe('normalizeDoubanRate', () => {
  it('数字与字符串都归一成一位小数', () => {
    expect(normalizeDoubanRate(6.6)).toBe('6.6');
    expect(normalizeDoubanRate('8.5')).toBe('8.5');
    expect(normalizeDoubanRate(' 7 ')).toBe('7.0');
    expect(normalizeDoubanRate(10)).toBe('10.0');
  });

  it('未开分 / 脏值归一成空字符串', () => {
    expect(normalizeDoubanRate(0)).toBe('');
    expect(normalizeDoubanRate('0')).toBe('');
    expect(normalizeDoubanRate(-1)).toBe('');
    expect(normalizeDoubanRate(11)).toBe('');
    expect(normalizeDoubanRate('')).toBe('');
    expect(normalizeDoubanRate('   ')).toBe('');
    expect(normalizeDoubanRate('abc')).toBe('');
    expect(normalizeDoubanRate(NaN)).toBe('');
    expect(normalizeDoubanRate(null)).toBe('');
    expect(normalizeDoubanRate(undefined)).toBe('');
    expect(normalizeDoubanRate({})).toBe('');
  });
});

describe('extractDoubanSubjectRate', () => {
  it('从 rexxar subject 详情里取 rating.value', () => {
    expect(
      extractDoubanSubjectRate({ rating: { value: 6.6, count: 100, max: 10 } })
    ).toBe('6.6');
  });

  it('未开分（rating 为 null 或 value 为 0）返回空', () => {
    expect(extractDoubanSubjectRate({ rating: null })).toBe('');
    expect(extractDoubanSubjectRate({ rating: { value: 0 } })).toBe('');
    expect(extractDoubanSubjectRate({})).toBe('');
    expect(extractDoubanSubjectRate(null)).toBe('');
    expect(extractDoubanSubjectRate('not json')).toBe('');
  });
});

describe('isDoubanSubjectId', () => {
  it('只认正整数 / 纯数字字符串', () => {
    expect(isDoubanSubjectId('36850814')).toBe(true);
    expect(isDoubanSubjectId(36850814)).toBe(true);
    expect(isDoubanSubjectId(' 36850814 ')).toBe(true);
  });

  it('空值 / 非数字 / 小数 / 负数一律不认', () => {
    expect(isDoubanSubjectId('')).toBe(false);
    expect(isDoubanSubjectId('   ')).toBe(false);
    expect(isDoubanSubjectId('abc')).toBe(false);
    expect(isDoubanSubjectId('36a')).toBe(false);
    expect(isDoubanSubjectId(0)).toBe(false);
    expect(isDoubanSubjectId(-1)).toBe(false);
    expect(isDoubanSubjectId(1.5)).toBe(false);
    expect(isDoubanSubjectId(null)).toBe(false);
    expect(isDoubanSubjectId(undefined)).toBe(false);
  });
});

describe('normalizeRateLookupIds', () => {
  it('去重、去空、去脏数据', () => {
    expect(normalizeRateLookupIds(['1', '1', '2', '', 'x', null, 3, 0])).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('截断到 limit', () => {
    const ids = Array.from({ length: 40 }, (_, i) => String(i + 1));
    expect(normalizeRateLookupIds(ids).length).toBe(RATE_LOOKUP_LIMIT);
    expect(normalizeRateLookupIds(ids, 3)).toEqual(['1', '2', '3']);
  });

  it('非数组返回空', () => {
    expect(normalizeRateLookupIds(null)).toEqual([]);
    expect(normalizeRateLookupIds('1,2,3')).toEqual([]);
    expect(normalizeRateLookupIds(undefined)).toEqual([]);
  });
});

describe('collectRateLookupIds', () => {
  it('只收「有 id 但没评分」的条目', () => {
    const items = [
      { id: '1', rate: '' },
      { id: '2', rate: '7.5' }, // 已有评分，跳过
      { id: '3' }, // rate 缺失，收
      { id: '', rate: '' }, // 无 id，跳过
      { id: 'x', rate: '' }, // 脏 id，跳过
    ];
    expect(collectRateLookupIds(items)).toEqual(['1', '3']);
  });

  it('去重并按 limit 截断', () => {
    expect(collectRateLookupIds([{ id: '1' }, { id: '1' }, { id: '2' }])).toEqual([
      '1',
      '2',
    ]);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1) }));
    expect(collectRateLookupIds(many).length).toBe(RATE_LOOKUP_LIMIT);
  });

  it('空输入返回空', () => {
    expect(collectRateLookupIds([])).toEqual([]);
    expect(collectRateLookupIds(null)).toEqual([]);
    expect(collectRateLookupIds(undefined)).toEqual([]);
  });
});

describe('mergeDoubanRates', () => {
  it('只填缺失的评分，其余字段原样保留', () => {
    const items = [
      { id: '1', title: 'A', rate: '' },
      { id: '2', title: 'B', rate: '5.0' },
      { id: '3', title: 'C', rate: '' },
    ];
    const merged = mergeDoubanRates(items, { 1: '6.6', 2: '9.9', 3: '0' });
    expect(merged).toEqual([
      { id: '1', title: 'A', rate: '6.6' },
      { id: '2', title: 'B', rate: '5.0' }, // 已有评分不被覆盖
      { id: '3', title: 'C', rate: '' }, // 没开分不填
    ]);
  });

  it('没有任何变化时返回原数组引用（避免无谓重渲染）', () => {
    const items = [
      { id: '1', rate: '' },
      { id: '2', rate: '7.0' },
    ];
    expect(mergeDoubanRates(items, { 1: '0', 2: '8.8' })).toBe(items);
    expect(mergeDoubanRates(items, {})).toBe(items);
    expect(mergeDoubanRates(items, null)).toBe(items);
    expect(mergeDoubanRates(items, undefined)).toBe(items);
  });

  it('有变化时返回新数组，原数组不被改动', () => {
    const items = [{ id: '1', rate: '' }];
    const merged = mergeDoubanRates(items, { 1: '6.66' });
    expect(merged).not.toBe(items);
    expect(merged[0].rate).toBe('6.7');
    expect(items[0].rate).toBe('');
  });
});
