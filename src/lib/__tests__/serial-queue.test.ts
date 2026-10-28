import {
  createSerialQueue,
  WRITE_YIELD_INTERVAL,
  yieldToMainThread,
} from '../serial-queue';

describe('yieldToMainThread', () => {
  test('返回可 await 的 Promise 且能正常 resolve', async () => {
    await expect(yieldToMainThread()).resolves.toBeUndefined();
  });

  test('连续调用都能完成（不能出现卡住不 resolve）', async () => {
    await Promise.all([
      yieldToMainThread(),
      yieldToMainThread(),
      yieldToMainThread(),
    ]);
  });

  test('优先用 scheduler.yield（若环境提供）', async () => {
    const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
    const original = g.scheduler;
    const spy = jest.fn(async () => undefined);
    g.scheduler = { yield: spy };
    try {
      await yieldToMainThread();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) delete g.scheduler;
      else g.scheduler = original;
    }
  });

  test('scheduler 没有 yield 时回退到 MessageChannel / setTimeout', async () => {
    const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
    const original = g.scheduler;
    g.scheduler = {};
    try {
      await expect(yieldToMainThread()).resolves.toBeUndefined();
    } finally {
      if (original === undefined) delete g.scheduler;
      else g.scheduler = original;
    }
  });
});

describe('createSerialQueue', () => {
  test('任务严格串行，不会交叠', async () => {
    const queue = createSerialQueue();
    let running = 0;
    let maxConcurrent = 0;
    const order: number[] = [];

    const task = (id: number) => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      // 模拟耗时不等的异步写入
      await new Promise((r) => setTimeout(r, id === 1 ? 20 : 1));
      order.push(id);
      running -= 1;
      return id;
    };

    // 同时入队：1 最慢，若并发执行则 2 会先完成
    const results = await Promise.all([
      queue.run(task(1)),
      queue.run(task(2)),
      queue.run(task(3)),
    ]);

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  test('前一个任务失败不影响后续任务', async () => {
    const queue = createSerialQueue();
    const done: string[] = [];

    const failing = queue.run(async () => {
      done.push('a');
      throw new Error('写入失败');
    });
    const next = queue.run(async () => {
      done.push('b');
      return 'ok';
    });

    await expect(failing).rejects.toThrow('写入失败');
    await expect(next).resolves.toBe('ok');
    expect(done).toEqual(['a', 'b']);
  });

  test('失败会抛给调用方（不能被队列吞掉）', async () => {
    const queue = createSerialQueue();
    await expect(
      queue.run(async () => {
        throw new Error('quota');
      })
    ).rejects.toThrow('quota');
  });

  test('多个失败连续发生，队列仍可继续工作', async () => {
    const queue = createSerialQueue();
    const results = await Promise.allSettled([
      queue.run(async () => Promise.reject(new Error('1'))),
      queue.run(async () => Promise.reject(new Error('2'))),
      queue.run(async () => 'third'),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'third' });
  });

  test('pending 计数反映排队中的任务', async () => {
    const queue = createSerialQueue();
    expect(queue.pending).toBe(0);

    const p1 = queue.run(() => new Promise((r) => setTimeout(() => r(1), 10)));
    const p2 = queue.run(() => new Promise((r) => setTimeout(() => r(2), 10)));
    expect(queue.pending).toBe(2);

    await Promise.all([p1, p2]);
    expect(queue.pending).toBe(0);
  });

  test('空队列也能反复使用（tail 不会残留 rejected 状态）', async () => {
    const queue = createSerialQueue();
    await queue.run(async () => 'a');
    await queue.run(async () => 'b');
    await queue.run(async () => 'c');
    await expect(queue.run(async () => 'd')).resolves.toBe('d');
  });
});

describe('WRITE_YIELD_INTERVAL', () => {
  test('取值合理：既不至于频繁让步，也不会一次写太久', () => {
    expect(WRITE_YIELD_INTERVAL).toBe(16);
    expect(WRITE_YIELD_INTERVAL).toBeGreaterThan(1);
    expect(WRITE_YIELD_INTERVAL).toBeLessThanOrEqual(64);
  });
});
