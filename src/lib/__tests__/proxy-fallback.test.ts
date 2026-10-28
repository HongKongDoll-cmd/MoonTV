import {
  buildProxyUrl,
  describeFetchError,
  fetchBufferWithProxyFallback,
  fetchTextWithProxyFallback,
  isProxyUrl,
  MEDIA_PROXY_PATH,
  shouldFallbackToProxy,
} from '../proxy-fallback';

function makeResponse(
  status: number,
  body: string | ArrayBuffer = 'ok',
  contentType = 'application/vnd.apple.mpegurl'
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    text: async () => String(body),
    arrayBuffer: async () => body as ArrayBuffer,
  } as unknown as Response;
}

describe('isProxyUrl', () => {
  test('识别同源代理地址', () => {
    expect(isProxyUrl('/api/m3u8?url=https%3A%2F%2Fx%2Fa.m3u8')).toBe(true);
    expect(isProxyUrl(MEDIA_PROXY_PATH)).toBe(true);
  });

  test('普通地址不是代理地址', () => {
    expect(isProxyUrl('https://x/a.m3u8')).toBe(false);
    expect(isProxyUrl('/api/m3u9?url=x')).toBe(false);
    expect(isProxyUrl('')).toBe(false);
  });
});

describe('buildProxyUrl', () => {
  test('http/https 地址会被包装成同源代理', () => {
    expect(buildProxyUrl('https://cdn.example.com/a/b.m3u8')).toBe(
      `${MEDIA_PROXY_PATH}?url=${encodeURIComponent(
        'https://cdn.example.com/a/b.m3u8'
      )}`
    );
  });

  test('已经是代理地址时不再包装（避免二次代理）', () => {
    expect(buildProxyUrl('/api/m3u8?url=x')).toBeNull();
  });

  test('data: / blob: 不做代理', () => {
    expect(buildProxyUrl('data:text/plain,abc')).toBeNull();
    expect(buildProxyUrl('blob:https://x/abc')).toBeNull();
  });

  test('空值与非法值返回 null', () => {
    expect(buildProxyUrl('')).toBeNull();
    expect(buildProxyUrl(undefined as unknown as string)).toBeNull();
  });

  test('相对地址会按当前页面解析成绝对地址再代理', () => {
    const out = buildProxyUrl('/videos/a.m3u8');
    expect(out).toContain(encodeURIComponent('a.m3u8'));
    expect(out).toContain('http');
  });
});

describe('shouldFallbackToProxy', () => {
  test('404 / 410 不兜底（文件确实不存在，多一次往返没意义）', () => {
    expect(shouldFallbackToProxy({ status: 404, networkError: false })).toBe(false);
    expect(shouldFallbackToProxy({ status: 410, networkError: false })).toBe(false);
  });

  test('401 / 403 要兜底（多半是 Referer / UA 校验，代理能过）', () => {
    expect(shouldFallbackToProxy({ status: 401, networkError: false })).toBe(true);
    expect(shouldFallbackToProxy({ status: 403, networkError: false })).toBe(true);
  });

  test('5xx 要兜底（可能是按来源 IP 限流）', () => {
    expect(shouldFallbackToProxy({ status: 503, networkError: false })).toBe(true);
  });

  test('网络错误要兜底（CORS 正是代理最能解决的）', () => {
    expect(shouldFallbackToProxy({ status: 0, networkError: true })).toBe(true);
    expect(shouldFallbackToProxy({ status: 0, networkError: false })).toBe(true);
  });
});

describe('describeFetchError', () => {
  test('任何 fetch 抛错都归一成网络层失败', () => {
    expect(describeFetchError(new TypeError('Failed to fetch'))).toEqual({
      status: 0,
      networkError: true,
    });
    expect(describeFetchError('boom')).toEqual({
      status: 0,
      networkError: true,
    });
  });
});

describe('fetchTextWithProxyFallback', () => {
  test('直连成功时不碰代理', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(200, '#EXTM3U'));
    const r = await fetchTextWithProxyFallback('https://x/a.m3u8', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(r).toEqual({ value: '#EXTM3U', viaProxy: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('直连 403 → 走代理并成功', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(403))
      .mockResolvedValueOnce(makeResponse(200, '#EXTM3U'));

    const onFallback = jest.fn();
    const r = await fetchTextWithProxyFallback('https://x/a.m3u8', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onFallback,
    });

    expect(r.viaProxy).toBe(true);
    expect(r.value).toBe('#EXTM3U');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // 第二次必须打到同源代理
    expect(String(fetchImpl.mock.calls[1][0])).toMatch(/^\/api\/m3u8\?url=/);
    expect(onFallback).toHaveBeenCalledWith({
      reason: 'http-403',
      proxyUrl: expect.stringContaining('/api/m3u8?url='),
    });
  });

  test('直连 404 不兜底，直接抛错（只请求一次）', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(404));
    await expect(
      fetchTextWithProxyFallback('https://x/a.m3u8', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow('请求失败: 404');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('直连网络错误（CORS/DNS）→ 走代理', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makeResponse(200, '#EXTM3U'));

    const r = await fetchTextWithProxyFallback('https://x/a.m3u8', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.viaProxy).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('代理也失败时抛错，不再回落到第三次', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(502));

    await expect(
      fetchTextWithProxyFallback('https://x/a.m3u8', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow('代理请求失败: 502');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('没有代理可用时（Node/SSR）直接抛原始错误', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(403));
    await expect(
      fetchTextWithProxyFallback('https://x/a.m3u8', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        proxyUrlBuilder: () => null,
      })
    ).rejects.toThrow('请求失败: 403');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('已取消时直接抛错，不做兜底', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = jest.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await expect(
      fetchTextWithProxyFallback('https://x/a.m3u8', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('传入的本来就是代理地址：直接请求，不做二次兜底', async () => {
    const fetchImpl = jest.fn(async () => makeResponse(200, '#EXTM3U'));
    const r = await fetchTextWithProxyFallback('/api/m3u8?url=x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.viaProxy).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('fetchBufferWithProxyFallback', () => {
  test('取 AES key 的二进制内容，同样支持兜底', async () => {
    const key = new ArrayBuffer(16);
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(403))
      .mockResolvedValueOnce(makeResponse(200, key, 'application/octet-stream'));

    const r = await fetchBufferWithProxyFallback('https://x/key', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(r.viaProxy).toBe(true);
    expect(r.value).toBe(key);
  });
});
