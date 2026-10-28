import {
  DEFAULT_SEARCH_CONCURRENCY,
  mapWithConcurrency,
  normalizeConcurrencyLimit,
  resolveSearchConcurrency,
  SEARCH_CONCURRENCY_MAX,
  SEARCH_CONCURRENCY_MIN,
} from '../concurrency-pool';

describe('normalizeConcurrencyLimit', () => {
  test('合法值原样（取整）返回', () => {
    expect(normalizeConcurrencyLimit(6)).toBe(6);
    expect(normalizeConcurrencyLimit('8')).toBe(8);
    expect(normalizeConcurrencyLimit(4.4)).toBe(4);
  });

  test('0 与负数会被抬到下限（0 会让池子一个都不跑）', () => {
    expect(normalizeConcurrencyLimit(0)).toBe(SEARCH_CONCURRENCY_MIN);
    expect(normalizeConcurrencyLimit(-5)).toBe(SEARCH_CONCURRENCY_MIN);
  });

  test('超大值会被压到上限（否则等于没有并发控制）', () => {
    expect(normalizeConcurrencyLimit(999)).toBe(SEARCH_CONCURRENCY_MAX);
    expect(normalizeConcurrencyLimit(17)).toBe(SEARCH_CONCURRENCY_MAX);
  });

  test('非法输入走 fallback', () => {
    expect(normalizeConcurrencyLimit(undefined)).toBe(DEFAULT_SEARCH_CONCURRENCY);
    expect(normalizeConcurrencyLimit(null)).toBe(DEFAULT_SEARCH_CONCURRENCY);
    expect(normalizeConcurrencyLimit('abc')).toBe(DEFAULT_SEARCH_CONCURRENCY);
    expect(normalizeConcurrencyLimit('')).toBe(DEFAULT_SEARCH_CONCURRENCY);
    expect(normalizeConcurrencyLimit(Number.NaN)).toBe(DEFAULT_SEARCH_CONCURRENCY);
  });

  test('fallback 自己越界时也会被夹住（环境变量写错的情况）', () => {
    expect(normalizeConcurrencyLimit('abc', 0)).toBe(SEARCH_CONCURRENCY_MIN);
    expect(normalizeConcurrencyLimit('abc', 9999)).toBe(SEARCH_CONCURRENCY_MAX);
  });

  test('bounds 可自定义', () => {
    expect(normalizeConcurrencyLimit(50, 6, { max: 4 })).toBe(4);
    expect(normalizeConcurrencyLimit(0, 6, { min: 2 })).toBe(2);
  });
});

describe('resolveSearchConcurrency', () => {
  test('请求值优先于环境变量', () => {
    expect(resolveSearchConcurrency('3', '10')).toBe(3);
  });

  test('没有请求值时用环境变量', () => {
    expect(resolveSearchConcurrency(undefined, '10')).toBe(10);
  });

  test('两者都没有时用默认值', () => {
    expect(resolveSearchConcurrency(undefined, undefined)).toBe(
      DEFAULT_SEARCH_CONCURRENCY
    );
  });

  test('空字符串视为未传（前端表单容易传空）', () => {
    expect(resolveSearchConcurrency('', '10')).toBe(10);
    expect(resolveSearchConcurrency(null, '10')).toBe(10);
  });

  test('请求值越界时按上限/下限夹住（服务端二次校验）', () => {
    expect(resolveSearchConcurrency('999', '6')).toBe(SEARCH_CONCURRENCY_MAX);
    expect(resolveSearchConcurrency('0', '6')).toBe(SEARCH_CONCURRENCY_MIN);
  });
});

describe('mapWithConcurrency', () => {
  test('结果顺序与入参一致（不是完成顺序）', async () => {
    const items = [30, 5, 20, 1];
    const out = await mapWithConcurrency(
      items,
      async (ms, i) => {
        await new Promise((r) => setTimeout(r, ms));
        return i;
      },
      2
    );
    expect(out).toEqual([0, 1, 2, 3]);
  });

  test('并发不超过上限', async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return true;
      },
      3
    );

    expect(peak).toBe(3);
  });

  test('limit 大于数组长度时按数组长度跑，不空转', async () => {
    const mapper = jest.fn(async (n: number) => n * 2);
    const out = await mapWithConcurrency([1, 2], mapper, 10);
    expect(out).toEqual([2, 4]);
    expect(mapper).toHaveBeenCalledTimes(2);
  });

  test('空数组直接返回，不调用 mapper', async () => {
    const mapper = jest.fn();
    await expect(mapWithConcurrency([], mapper, 4)).resolves.toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  test('单个任务抛错会抛给调用方（由调用方决定失败怎么收集）', async () => {
    await expect(
      mapWithConcurrency(
        [1, 2, 3],
        async (n) => {
          if (n === 2) throw new Error('源失败');
          return n;
        },
        2
      )
    ).rejects.toThrow('源失败');
  });

  test('limit 传 0 或非法值时按 1 处理（不能一个都不跑）', async () => {
    const mapper = jest.fn(async (n: number) => n);
    await mapWithConcurrency([1, 2, 3], mapper, 0);
    expect(mapper).toHaveBeenCalledTimes(3);
  });

  test('串行（limit=1）时严格按顺序执行', async () => {
    const order: number[] = [];
    await mapWithConcurrency(
      [1, 2, 3],
      async (n) => {
        await new Promise((r) => setTimeout(r, 1));
        order.push(n);
        return n;
      },
      1
    );
    expect(order).toEqual([1, 2, 3]);
  });

  test('所有任务都被执行且只执行一次', async () => {
    const seen = new Map<number, number>();
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      async (n) => {
        seen.set(n, (seen.get(n) ?? 0) + 1);
        return n;
      },
      4
    );
    expect(seen.size).toBe(20);
    Array.from(seen.values()).forEach((count) => expect(count).toBe(1));
  });
});
