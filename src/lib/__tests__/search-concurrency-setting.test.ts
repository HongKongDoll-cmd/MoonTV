import {
  SEARCH_CONCURRENCY_AUTO,
  SEARCH_CONCURRENCY_CLIENT_MAX,
  SEARCH_CONCURRENCY_STORAGE_KEY,
  loadSearchConcurrencySetting,
  normalizeSearchConcurrencySetting,
  saveSearchConcurrencySetting,
  toSearchConcurrencyParam,
} from '../search-concurrency-setting';

describe('normalizeSearchConcurrencySetting', () => {
  test('合法值取整保留', () => {
    expect(normalizeSearchConcurrencySetting(6)).toBe(6);
    expect(normalizeSearchConcurrencySetting('4')).toBe(4);
    expect(normalizeSearchConcurrencySetting(4.6)).toBe(5);
  });

  test('0 与负数表示「自动」', () => {
    expect(normalizeSearchConcurrencySetting(0)).toBe(SEARCH_CONCURRENCY_AUTO);
    expect(normalizeSearchConcurrencySetting(-3)).toBe(SEARCH_CONCURRENCY_AUTO);
    expect(normalizeSearchConcurrencySetting('0')).toBe(SEARCH_CONCURRENCY_AUTO);
  });

  test('超过上限被压住（与服务端上限一致）', () => {
    expect(normalizeSearchConcurrencySetting(999)).toBe(
      SEARCH_CONCURRENCY_CLIENT_MAX
    );
    expect(normalizeSearchConcurrencySetting('20')).toBe(
      SEARCH_CONCURRENCY_CLIENT_MAX
    );
  });

  test('非法输入回落到自动', () => {
    expect(normalizeSearchConcurrencySetting(undefined)).toBe(SEARCH_CONCURRENCY_AUTO);
    expect(normalizeSearchConcurrencySetting(null)).toBe(SEARCH_CONCURRENCY_AUTO);
    expect(normalizeSearchConcurrencySetting('abc')).toBe(SEARCH_CONCURRENCY_AUTO);
    expect(normalizeSearchConcurrencySetting('')).toBe(SEARCH_CONCURRENCY_AUTO);
    expect(normalizeSearchConcurrencySetting(Number.NaN)).toBe(SEARCH_CONCURRENCY_AUTO);
  });
});

describe('本地存储读写', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('没设置过时返回自动', () => {
    expect(loadSearchConcurrencySetting()).toBe(SEARCH_CONCURRENCY_AUTO);
  });

  test('保存后能读回', () => {
    saveSearchConcurrencySetting(8);
    expect(window.localStorage.getItem(SEARCH_CONCURRENCY_STORAGE_KEY)).toBe('8');
    expect(loadSearchConcurrencySetting()).toBe(8);
  });

  test('保存时会把非法值规范化再落盘', () => {
    expect(saveSearchConcurrencySetting(999)).toBe(SEARCH_CONCURRENCY_CLIENT_MAX);
    expect(window.localStorage.getItem(SEARCH_CONCURRENCY_STORAGE_KEY)).toBe(
      String(SEARCH_CONCURRENCY_CLIENT_MAX)
    );
  });

  test('存储里是脏值时回落到自动，不抛错', () => {
    window.localStorage.setItem(SEARCH_CONCURRENCY_STORAGE_KEY, 'many');
    expect(loadSearchConcurrencySetting()).toBe(SEARCH_CONCURRENCY_AUTO);
  });

  test('保存自动模式会写入 0（便于回显）', () => {
    saveSearchConcurrencySetting(0);
    expect(window.localStorage.getItem(SEARCH_CONCURRENCY_STORAGE_KEY)).toBe('0');
  });
});

describe('toSearchConcurrencyParam', () => {
  test('自动模式不传参（返回 null）', () => {
    expect(toSearchConcurrencyParam(0)).toBeNull();
    expect(toSearchConcurrencyParam(-1)).toBeNull();
  });

  test('指定值转成字符串参数', () => {
    expect(toSearchConcurrencyParam(6)).toBe('6');
    expect(toSearchConcurrencyParam(999)).toBe(
      String(SEARCH_CONCURRENCY_CLIENT_MAX)
    );
  });
});
