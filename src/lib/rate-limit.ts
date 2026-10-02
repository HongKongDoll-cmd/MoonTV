/**
 * 极简滑动窗口限流器（内存版，edge runtime 可用）。
 *
 * 为什么需要它：`/api/image-proxy` 在 middleware 里是**免登录**白名单，
 * 任何人都能拿它刷豆瓣图消耗本机出口带宽；`/api/login` 没有失败锁定，
 * 可以被暴力破解。这里给两者共用一套限流原语。
 *
 * 存储是**进程内 Map**，不是 Redis：
 * - 自部署（Docker / NAS）单实例场景下完全有效，也不用给部署增加依赖；
 * - Serverless（Vercel Edge）里每个 isolate 各限各的，属于「尽力而为」——
 *   防不住有心的分布式刷取，但能挡住脚本小子，别把它当 WAF 用。
 *
 * 纯逻辑、无副作用入口依赖（时间可注入），便于单测。
 */

export interface RateLimitOptions {
  /** 滑动窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大次数 */
  max: number;
  /** 最多记录多少个 key，防止被大量随机 key 撑爆内存（默认 5000） */
  maxKeys?: number;
  /** 注入时间源（测试用） */
  now?: () => number;
}

export interface RateLimitResult {
  /** 本次是否放行 */
  allowed: boolean;
  /** 剩余可用次数（已被拒绝时为 0） */
  remaining: number;
  /** 距离解除限制还需等待多少秒（放行时为 0） */
  retryAfterSec: number;
}

export interface RateLimiter {
  /** 记一次并判断是否放行 */
  hit: (key: string) => RateLimitResult;
  /** 只看不记（不消耗额度） */
  peek: (key: string) => RateLimitResult;
  /** 清掉某个 key 的计数；省略 key 则全清 */
  reset: (key?: string) => void;
  /** 当前记录了多少个 key（测试用） */
  size: () => number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const windowMs = Math.max(1, options.windowMs);
  const max = Math.max(1, options.max);
  const maxKeys = Math.max(1, options.maxKeys ?? 5000);
  const now = options.now ?? (() => Date.now());

  const hits = new Map<string, number[]>();

  /** 取出 key 的有效时间戳，顺手把过期的丢掉 */
  function liveTimestamps(key: string, at: number): number[] {
    const list = hits.get(key);
    if (!list) return [];
    const alive = list.filter((t) => at - t < windowMs);
    if (alive.length === 0) {
      hits.delete(key);
      return [];
    }
    if (alive.length !== list.length) {
      hits.set(key, alive);
    }
    return alive;
  }

  /** 防止随机 key 无限增长：超量时丢掉最早的一批 */
  function evictIfNeeded() {
    if (hits.size <= maxKeys) return;
    // 用 Array.from 包装：tsconfig target 低于 es2015 时 for...of 不能迭代 Map 键
    const keys = Array.from(hits.keys());
    for (let i = 0; i < keys.length && hits.size > maxKeys; i += 1) {
      hits.delete(keys[i]);
    }
  }

  function evaluate(key: string, at: number, record: boolean): RateLimitResult {
    const alive = liveTimestamps(key, at);
    if (alive.length >= max) {
      // 最早那次过期后才会腾出位置
      const retryAfterSec = Math.max(
        1,
        Math.ceil((alive[0] + windowMs - at) / 1000)
      );
      return { allowed: false, remaining: 0, retryAfterSec };
    }
    if (record) {
      alive.push(at);
      hits.set(key, alive);
      evictIfNeeded();
    }
    // push 之后 alive.length 就是窗口内已用次数
    return {
      allowed: true,
      remaining: Math.max(0, max - alive.length),
      retryAfterSec: 0,
    };
  }

  return {
    hit(key: string) {
      return evaluate(String(key), now(), true);
    },
    peek(key: string) {
      return evaluate(String(key), now(), false);
    },
    reset(key?: string) {
      if (key === undefined) hits.clear();
      else hits.delete(String(key));
    },
    size() {
      return hits.size;
    },
  };
}

/**
 * 从请求头取客户端 IP。
 *
 * 顺序按「最靠近边缘、越不可伪造」排列：Cloudflare / Vercel 的头由平台保证，
 * 直连自部署时它们不存在，会落到最后两项。
 * 取不到时返回空串（调用方自行决定怎么兜底，通常按同一个共享 key 处理）。
 */
export function clientIpFromRequest(request: Request): string {
  const headers = request.headers;
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',')[0],
  ];
  for (const item of candidates) {
    const value = (item || '').trim();
    if (value) return value;
  }
  return '';
}

/** 429 响应的标准头 + 统一的 JSON 提示 */
export function rateLimitResponse(
  result: RateLimitResult,
  message: string
): Response {
  return new Response(JSON.stringify({ error: message, retryAfterSec: result.retryAfterSec }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfterSec),
    },
  });
}
