/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BANGUMI_REQUEST_TIMEOUT,
  GetBangumiCalendarData,
} from '../bangumi.client';

function mockFetchOnce(impl: (...args: any[]) => Promise<unknown>) {
  (global as any).fetch = jest.fn(impl);
}

const OK_PAYLOAD = [
  {
    weekday: { en: 'Fri' },
    items: [
      {
        id: 1,
        name: 'a',
        name_cn: '甲',
        rating: { score: 7 },
        air_date: '2026-01-02',
        images: { large: 'https://lain.bgm.tv/1.jpg' },
      },
      { id: 2, name: 'b', name_cn: '乙', rating: { score: 6 }, air_date: '' },
    ],
  },
];

describe('GetBangumiCalendarData', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete (global as any).fetch;
  });

  test('正常返回时按周过滤掉没有 images 的条目', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => OK_PAYLOAD,
    }));
    const data = await GetBangumiCalendarData();
    expect(data).toHaveLength(1);
    expect(data[0].items).toHaveLength(1);
    expect(data[0].items[0].name_cn).toBe('甲');
  });

  test('请求带上超时 signal（直连不通时能自己放弃）', async () => {
    let signal: AbortSignal | undefined;
    mockFetchOnce(async (_url: string, init: any) => {
      signal = init?.signal;
      return { ok: true, json: async () => OK_PAYLOAD };
    });
    await GetBangumiCalendarData();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(BANGUMI_REQUEST_TIMEOUT).toBeGreaterThan(0);
  });

  test('网络不可达（fetch 抛错）→ 返回空数组，不向上抛', async () => {
    mockFetchOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(GetBangumiCalendarData()).resolves.toEqual([]);
  });

  test('超时中断（AbortError）→ 返回空数组', async () => {
    mockFetchOnce(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(GetBangumiCalendarData()).resolves.toEqual([]);
  });

  test('非 200 → 返回空数组', async () => {
    mockFetchOnce(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await expect(GetBangumiCalendarData()).resolves.toEqual([]);
  });

  test('返回体不是数组 → 返回空数组', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ message: 'blocked' }),
    }));
    await expect(GetBangumiCalendarData()).resolves.toEqual([]);
  });

  test('JSON 解析失败 → 返回空数组', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    await expect(GetBangumiCalendarData()).resolves.toEqual([]);
  });

  test('超时定时器会被清理（不会挂住事件循环）', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    mockFetchOnce(async () => ({ ok: true, json: async () => OK_PAYLOAD }));
    await GetBangumiCalendarData();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
