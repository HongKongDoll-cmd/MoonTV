/**
 * 异步结果的记忆化（4.8.1）。
 *
 * 为什么不是简单的 `Map<key, Promise>`：
 * 那样会有三个实际问题 ——
 *  1. **失败会被永久缓存**。网络抖一下拿到 rejected Promise，之后所有调用都拿到
 *     同一个失败结果，除非刷新页面。所以只缓存成功结果，失败立刻清掉。
 *  2. **并发重复请求**。同一个 key 同时被多处调用时，只应该真正跑一次，
 *     其余等同一个 Promise —— 但「等」和「缓存」是两件事，要分开处理。
 *  3. **无限增长**。简介这类数据条目多、命中率分散，不设上限迟早吃满内存。
 *
 * 这里做成近似 LRU：命中时把条目移到队尾，超出上限就从队首（最久未用）淘汰。
 * 之所以是「近似」而不是严格 LRU，是因为用的是 Map 的插入顺序，
 * 一次删除 O(1)、无需额外链表 —— 对简介缓存这种量级完全够用。
 */

export interface MemoizeAsyncOptions {
  /** 最多缓存多少个 key，默认 100 */
  max?: number;
  /**
   * 条目存活时间（毫秒），默认 30 分钟。
   * 传 0 或负数表示永不过期（只靠 LRU 淘汰）。
   */
  ttlMs?: number;
}

export const DEFAULT_MEMOIZE_MAX = 100;
export const DEFAULT_MEMOIZE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry<V> {
  value: V;
  /** 写入时间，用于 TTL 判断 */
  storedAt: number;
}

export interface MemoizedAsync<K, V> {
  (key: K): Promise<V>;
  /** 清空全部缓存（含进行中的请求登记） */
  clear(): void;
  /** 当前缓存条目数 */
  size(): number;
  /** 是否已有该 key 的有效缓存（不触发请求） */
  has(key: K): boolean;
}

/**
 * 把「按 key 的异步查询」包成带缓存的函数。
 *
 * @param loader 真正干活的函数；**必须保证同一 key 的结果是稳定的**
 * @param options 上限与 TTL
 */
export function memoizeAsync<K, V>(
  loader: (key: K) => Promise<V>,
  options: MemoizeAsyncOptions = {}
): MemoizedAsync<K, V> {
  const max = Math.max(1, Math.floor(options.max ?? DEFAULT_MEMOIZE_MAX));
  const ttlMs = options.ttlMs ?? DEFAULT_MEMOIZE_TTL_MS;

  const cache = new Map<K, CacheEntry<V>>();
  /** 进行中的请求：只用于并发去重，成功后删除、失败后也删除 */
  const inflight = new Map<K, Promise<V>>();

  const isExpired = (entry: CacheEntry<V>) =>
    ttlMs > 0 && Date.now() - entry.storedAt > ttlMs;

  /** 命中即移到队尾，维持"队首是最久未用" */
  const touch = (key: K, entry: CacheEntry<V>) => {
    cache.delete(key);
    cache.set(key, entry);
  };

  const prune = () => {
    while (cache.size > max) {
      const oldest = cache.keys().next();
      if (oldest.done) return;
      cache.delete(oldest.value);
    }
  };

  const memoized = (async (key: K): Promise<V> => {
    const cached = cache.get(key);
    if (cached && !isExpired(cached)) {
      touch(key, cached);
      return cached.value;
    }
    if (cached) {
      // 过期条目就地清掉，别留着占位
      cache.delete(key);
    }

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = loader(key);
    inflight.set(key, promise);

    try {
      const value = await promise;
      // **只缓存成功结果**：失败留着会变成"永久失败"
      cache.set(key, { value, storedAt: Date.now() });
      prune();
      return value;
    } finally {
      // 成功、失败、取消都要撤掉登记，否则同一 key 永远等这一个 Promise
      inflight.delete(key);
    }
  }) as MemoizedAsync<K, V>;

  memoized.clear = () => {
    cache.clear();
    inflight.clear();
  };
  memoized.size = () => cache.size;
  memoized.has = (key: K) => {
    const entry = cache.get(key);
    return !!entry && !isExpired(entry);
  };

  return memoized;
}
