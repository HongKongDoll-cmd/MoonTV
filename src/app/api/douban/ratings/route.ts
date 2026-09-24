import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import {
  extractDoubanSubjectRate,
  normalizeRateLookupIds,
  RATE_LOOKUP_CONCURRENCY,
  RATE_LOOKUP_LIMIT,
  RATE_LOOKUP_TIMEOUT,
} from '@/lib/douban-rating';

export const runtime = 'edge';

/** 豆瓣 subject 详情（电影/剧集通用，无需区分 movie / tv）。 */
function buildSubjectUrl(id: string): string {
  return `https://m.douban.com/rexxar/api/v2/subject/${id}`;
}

async function fetchSubjectRate(id: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RATE_LOOKUP_TIMEOUT);

  try {
    const response = await fetch(buildSubjectUrl(id), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://m.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return '';
    return extractDoubanSubjectRate(await response.json());
  } catch {
    clearTimeout(timeoutId);
    return '';
  }
}

/**
 * 限并发地跑完一批任务。
 *
 * 豆瓣对高频请求很敏感：24 个条目一次性 `Promise.all` 打出去容易被掐，
 * 所以这里老老实实排队，一次只放行 `RATE_LOOKUP_CONCURRENCY` 个。
 */
async function mapWithConcurrency<T>(
  ids: string[],
  concurrency: number,
  worker: (id: string) => Promise<T>
): Promise<T[]> {
  const results: T[] = new Array(ids.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, ids.length) }, () => {
    return (async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        results[index] = await worker(ids[index]);
      }
    })();
  });

  await Promise.all(runners);
  return results;
}

/**
 * 批量查豆瓣评分。
 *
 * POST `{ ids: ['36850814', ...] }` → `{ code: 200, rates: { '36850814': '6.6' } }`。
 *
 * 只返回**查到了**的条目；查不到（未开分 / 请求失败）的 id 不出现在 `rates` 里。
 * 调用方（`douban.client.ts`）会把这一批 id 全部标记为「已查过」，避免重复打豆瓣。
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const rawIds = (payload as { ids?: unknown } | null)?.ids;
  const ids = normalizeRateLookupIds(rawIds, RATE_LOOKUP_LIMIT);

  if (ids.length === 0) {
    return NextResponse.json({ code: 200, message: 'ok', rates: {} });
  }

  const values = await mapWithConcurrency(
    ids,
    RATE_LOOKUP_CONCURRENCY,
    fetchSubjectRate
  );

  const rates: Record<string, string> = {};
  ids.forEach((id, index) => {
    const rate = values[index];
    if (rate) rates[id] = rate;
  });

  const cacheTime = await getCacheTime();
  return NextResponse.json(
    { code: 200, message: 'ok', rates },
    {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    }
  );
}
