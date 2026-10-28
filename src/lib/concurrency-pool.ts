/**
 * 异步并发控制（4.7.8）。
 *
 * 搜索是典型的「多源并行」场景：源列表有十几个采集站，全部同时打出去
 * 会让出站连接瞬间打满 —— 家庭网络的上行、源站的限流都会跟着炸，
 * 结果反而比串行还慢，而且部分源会直接 429。
 *
 * 但做成串行又太慢：一个源 3 秒，十个源就是 30 秒。
 * 并发池是折中：同时最多 N 个在跑，跑完一个补一个。
 */

/** 默认并发数：与上游一致 */
export const DEFAULT_SEARCH_CONCURRENCY = 6;

/** 允许范围。上限刻意不高 —— 再多对单个家庭出口没有收益，只会互相挤 */
export const SEARCH_CONCURRENCY_MIN = 1;
export const SEARCH_CONCURRENCY_MAX = 16;

/**
 * 把任意输入归一成合法的并发数。
 *
 * 前端可以传并发值上来让用户自己调，所以**必须**在服务端再校验一次：
 * 传 0 会让池子一个都不跑（搜索结果永远为空），传 999 等于没有上限。
 */
export function normalizeConcurrencyLimit(
  raw: unknown,
  fallback: number = DEFAULT_SEARCH_CONCURRENCY,
  bounds: { min?: number; max?: number } = {}
): number {
  const min = bounds.min ?? SEARCH_CONCURRENCY_MIN;
  const max = bounds.max ?? SEARCH_CONCURRENCY_MAX;

  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    // fallback 自己也可能不合法（环境变量写错），所以也要夹一遍
    return Math.min(max, Math.max(min, Math.round(fallback)));
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * 读取搜索源并发：请求参数优先，其次环境变量，最后默认值。
 *
 * 环境变量用 `NEXT_PUBLIC_SEARCH_SOURCE_CONCURRENCY`（与上游一致）。
 * 它在服务端同样可读 —— 前缀只影响是否内联到客户端包，不影响 `process.env`。
 */
export function resolveSearchConcurrency(
  requestValue?: unknown,
  envValue: string | number | undefined = process.env
    .NEXT_PUBLIC_SEARCH_SOURCE_CONCURRENCY
): number {
  const fallback = normalizeConcurrencyLimit(
    envValue,
    DEFAULT_SEARCH_CONCURRENCY
  );
  if (requestValue === undefined || requestValue === null || requestValue === '') {
    return fallback;
  }
  return normalizeConcurrencyLimit(requestValue, fallback);
}

/**
 * 带并发上限地执行 map，**返回顺序与入参一致**。
 *
 * 结果顺序很要紧：搜索结果是按源列表顺序拼起来的，池子跑完的先后
 * 与源顺序无关，不按 index 写回的话，结果会随机跳动。
 *
 * 单个任务抛错会原样抛给调用方 —— 池子不替调用方决定「失败的源怎么办」，
 * 搜索接口需要把失败源单独收集起来展示。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  limit: number
): Promise<R[]> {
  const total = items.length;
  if (total === 0) return [];

  const concurrency = Math.max(1, Math.min(total, Math.floor(limit) || 1));
  const results = new Array<R>(total);

  let cursor = 0;
  const worker = async (): Promise<void> => {
    // for(;;) 而不是 while(true)：后者会触发 no-constant-condition
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );
  return results;
}
