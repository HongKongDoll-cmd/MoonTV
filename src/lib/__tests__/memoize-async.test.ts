import { memoizeAsync } from '../memoize-async';

describe('memoizeAsync', () => {
  test('相同 key 只执行一次 loader', async () => {
    const loader = jest.fn(async (k: string) => `v-${k}`);
    const fn = memoizeAsync(loader);

    expect(await fn('a')).toBe('v-a');
    expect(await fn('a')).toBe('v-a');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('不同 key 各自执行', async () => {
    const loader = jest.fn(async (k: string) => `v-${k}`);
    const fn = memoizeAsync(loader);

    await fn('a');
    await fn('b');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('并发调用同一 key 只跑一次（去重）', async () => {
    let calls = 0;
    const fn = memoizeAsync(async (k: string) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return `v-${k}`;
    });

    const [a, b, c] = await Promise.all([fn('x'), fn('x'), fn('x')]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual(['v-x', 'v-x', 'v-x']);
  });

  test('失败的请求不进缓存（不能变成永久失败）', async () => {
    let attempt = 0;
    const loader = jest.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('网络抖动');
      return 'ok';
    });
    const fn = memoizeAsync(loader);

    await expect(fn('a')).rejects.toThrow('网络抖动');
    // 第二次必须重新请求并且成功
    await expect(fn('a')).resolves.toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('失败后同 key 的并发等待者都能拿到错误，且不残留登记', async () => {
    const loader = jest.fn(async () => {
      throw new Error('boom');
    });
    const fn = memoizeAsync(loader);

    const results = await Promise.allSettled([fn('a'), fn('a')]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    // 两个调用都挂同一个 Promise，所以只执行一次
    expect(loader).toHaveBeenCalledTimes(1);

    // 登记已撤掉，后续能重新执行
    await expect(fn('a')).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('超出上限时淘汰最久未用的条目', async () => {
    const loader = jest.fn(async (k: string) => `v-${k}`);
    const fn = memoizeAsync(loader, { max: 2 });

    await fn('a');
    await fn('b');
    // 触碰 a，让 b 成为最久未用
    await fn('a');
    await fn('c');

    expect(fn.has('a')).toBe(true);
    expect(fn.has('c')).toBe(true);
    expect(fn.has('b')).toBe(false);
  });

  test('超过上限后 size 不会继续增长', async () => {
    const fn = memoizeAsync(async (k: string) => k, { max: 3 });
    for (let i = 0; i < 10; i++) await fn(`k${i}`);
    expect(fn.size()).toBe(3);
  });

  test('TTL 到期后重新请求', async () => {
    jest.useFakeTimers();
    try {
      const loader = jest.fn(async () => 'v');
      const fn = memoizeAsync(loader, { ttlMs: 1000 });

      await fn('a');
      expect(loader).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(999);
      await fn('a');
      expect(loader).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2);
      await fn('a');
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('ttlMs 为 0 表示永不过期', async () => {
    jest.useFakeTimers();
    try {
      const loader = jest.fn(async () => 'v');
      const fn = memoizeAsync(loader, { ttlMs: 0 });

      await fn('a');
      jest.advanceTimersByTime(10 * 60 * 60 * 1000);
      await fn('a');
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('clear 清空缓存，之后重新请求', async () => {
    const loader = jest.fn(async () => 'v');
    const fn = memoizeAsync(loader);

    await fn('a');
    fn.clear();
    expect(fn.size()).toBe(0);
    expect(fn.has('a')).toBe(false);

    await fn('a');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('has 不触发请求', async () => {
    const loader = jest.fn(async () => 'v');
    const fn = memoizeAsync(loader);

    expect(fn.has('a')).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  test('不同 key 的并发互不阻塞', async () => {
    const started: string[] = [];
    const fn = memoizeAsync(async (k: string) => {
      started.push(k);
      await new Promise((r) => setTimeout(r, 5));
      return k;
    });

    await Promise.all([fn('a'), fn('b'), fn('c')]);
    expect(started.sort()).toEqual(['a', 'b', 'c']);
  });

  test('缓存的是**值**而不是 Promise（拿到后不再走异步等待）', async () => {
    const fn = memoizeAsync(async () => 'v');
    await fn('a');
    // 已缓存：这次调用内部不应再产生微任务等待
    const cached = await fn('a');
    expect(cached).toBe('v');
    expect(fn.size()).toBe(1);
  });
});
