import {
  delayForAttempt,
  fetchSegmentWithRetry,
  isRetryableStatus,
  SEGMENT_RETRY_POLICY,
} from '../segment-retry';

/** 造一个最小的 Response，避免依赖 jsdom 的 Response 实现细节 */
function makeResponse(
  status: number,
  body: ArrayBuffer = new ArrayBuffer(8),
  contentType: string | null = 'video/mp2t'
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'Content-Type' ? contentType : null) },
    arrayBuffer: async () => body,
  } as unknown as Response;
}

const noSleep = () => Promise.resolve();

describe('isRetryableStatus', () => {
  test('鉴权与不存在类失败不重试（重试只会在同一个错误上打转）', () => {
    for (const status of [400, 401, 403, 404, 405, 410, 451]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  test('服务端错误值得重试', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  test('408 / 429 是瞬时失败，值得重试', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
  });

  test('没拿到响应（status=0）按网络错误处理，值得重试', () => {
    expect(isRetryableStatus(0)).toBe(true);
    expect(isRetryableStatus(-1)).toBe(true);
    expect(isRetryableStatus(Number.NaN)).toBe(true);
  });

  test('2xx/3xx 不在「该重试」的集合里（调用方本就不该问）', () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(302)).toBe(false);
  });
});

describe('delayForAttempt', () => {
  test('按顺序取退避时间', () => {
    expect(delayForAttempt(SEGMENT_RETRY_POLICY, 1)).toBe(1000);
    expect(delayForAttempt(SEGMENT_RETRY_POLICY, 2)).toBe(2000);
  });

  test('超出 delays 长度时复用最后一个值', () => {
    expect(delayForAttempt(SEGMENT_RETRY_POLICY, 3)).toBe(2000);
    expect(delayForAttempt(SEGMENT_RETRY_POLICY, 99)).toBe(2000);
  });

  test('空 delays 有兜底值，不能返回 undefined', () => {
    expect(delayForAttempt({ attempts: 3, delays: [] }, 1)).toBe(1000);
  });

  test('attempt 小于 1 时不会取到负下标', () => {
    expect(delayForAttempt(SEGMENT_RETRY_POLICY, 0)).toBe(1000);
  });
});

describe('fetchSegmentWithRetry', () => {
  test('首次成功：只请求一次', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(200));
    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.byteLength).toBe(8);
      expect(result.contentType).toBe('video/mp2t');
      expect(result.costMs).toBeGreaterThanOrEqual(1);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('5xx 重试后成功', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(502))
      .mockResolvedValueOnce(makeResponse(200));

    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('404 立即失败，不做无意义重试', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(404));
    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result).toEqual({ ok: false, reason: 'http', status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('一直 5xx：用尽次数后返回最后一次状态', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(500));
    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result).toEqual({ ok: false, reason: 'http', status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(SEGMENT_RETRY_POLICY.attempts);
  });

  test('网络错误重试后仍失败 → reason=network', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result).toEqual({ ok: false, reason: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(SEGMENT_RETRY_POLICY.attempts);
  });

  test('已 abort 时一次都不请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = jest.fn(async () => makeResponse(200));

    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('请求中 abort 不再重试', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    const promise = fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      signal: controller.signal,
    });
    controller.abort();
    const result = await promise;

    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('状态 200 但读取 body 失败 → 视为网络错误并重试', async () => {
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () => {
            throw new TypeError('terminated');
          },
        } as unknown as Response;
      }
      return makeResponse(200);
    });

    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('onRetry 收到重试原因与退避时长', async () => {
    const onRetry = jest.fn();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));

    await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 1000,
      reason: 'http',
      status: 503,
    });
  });

  test('attempts=1 表示不重试', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(500));
    const result = await fetchSegmentWithRetry('https://x/1.ts', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      policy: { attempts: 1, delays: [1000] },
    });

    expect(result).toMatchObject({ ok: false, reason: 'http' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
