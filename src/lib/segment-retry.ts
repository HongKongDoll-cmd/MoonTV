/**
 * 分片下载重试（4.7.3）。
 *
 * 为什么需要：预取器原来的做法是「失败就 `continue` 下一个」。
 * 家庭网络抖动、源站偶发 502、CDN 边界节点超时都会让个别分片掉队，
 * 而掉队的分片正是播放到那个位置时**要现拉**的那一段 ——
 * 结果就是「明明在缓存，播到某处还是卡一下」。
 *
 * 但重试不是无脑重来：
 * - **4xx 不重试**。401/403/404/410 是确定性失败（鉴权过期、源站没这个文件），
 *   重试 3 次只是把 3 秒浪费掉，还会阻塞后面真正能成功的分片；
 * - **只重试网络错误与 5xx / 408 / 429**，那些是瞬时的；
 * - **退避而不是死循环立刻重试**：1s → 2s → 4s。立刻重试在弱网下
 *   等于把同样的失败连做三次。
 */

/** 单个分片的重试策略 */
export interface SegmentRetryPolicy {
  /** 总尝试次数（含首次），必须 ≥ 1 */
  attempts: number;
  /** 第 n 次失败后的等待毫秒数；不足时复用最后一个值 */
  delays: number[];
}

/**
 * 默认策略：最多 3 次尝试（首次 + 2 次重试），退避 1s / 2s。
 *
 * 上游写的是「最多 3 次，间隔 1/2/4 秒」，这里对齐**重试次数**语义：
 * attempts=3 表示一共试 3 次。间隔取前两个 1s、2s —— 预取是后台行为，
 * 等 4s 还不如把这 4 秒用来下下一个分片；真正对时间敏感的是播放器，
 * 那边的重试由 hls.js 自己管。
 */
export const SEGMENT_RETRY_POLICY: SegmentRetryPolicy = {
  attempts: 3,
  delays: [1000, 2000],
};

/**
 * 确定性失败的状态码：重试只会在同一个错误上打转。
 *
 * 400 参数错误 / 401 未授权 / 403 禁止 / 404 不存在 / 405 方法不允许 /
 * 410 已删除 / 451 因法律原因不可用 —— 这些重试 100 次结果一样。
 */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 405, 410, 451]);

/**
 * 该状态码是否值得重试。
 *
 * @param status HTTP 状态码；`0`（或非有限值）表示请求根本没拿到响应
 *               （DNS / 连接被拒 / CORS），按网络错误处理 → 值得重试
 */
export function isRetryableStatus(status: number): boolean {
  if (!Number.isFinite(status) || status <= 0) return true;
  if (NON_RETRYABLE_STATUS.has(status)) return false;
  // 408 请求超时、429 限流：都是瞬时的，等一会儿就好
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

/** 第 `attempt` 次失败后应该等多久（attempt 从 1 开始） */
export function delayForAttempt(
  policy: SegmentRetryPolicy,
  attempt: number
): number {
  const delays = policy.delays.length ? policy.delays : [1000];
  const index = Math.min(Math.max(attempt - 1, 0), delays.length - 1);
  return Math.max(0, delays[index]);
}

/** 一次下载尝试的结果 */
export type SegmentFetchResult =
  | {
      ok: true;
      buffer: ArrayBuffer;
      contentType: string | null;
      /** 本次请求耗时（毫秒），供 ABR 带宽估算使用 */
      costMs: number;
    }
  | {
      ok: false;
      /** http：拿到了响应但状态码不可用；network：没拿到响应；aborted：被取消 */
      reason: 'http' | 'network' | 'aborted';
      status?: number;
    };

export interface FetchSegmentOptions {
  signal?: AbortSignal;
  policy?: SegmentRetryPolicy;
  /** 注入 sleep 便于测试；默认用 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** 每次重试前回调（用于提示/日志） */
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    reason: 'http' | 'network';
    status?: number;
  }) => void;
  /** 覆盖 fetch（测试用） */
  fetchImpl?: typeof fetch;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 带重试地下载一个分片。
 *
 * 只负责「拿到数据」这一件事：不写缓存、不更新统计 —— 调用方（预取器）
 * 自己决定拿到之后怎么办。这样缓存逻辑与网络重试互不纠缠。
 */
export async function fetchSegmentWithRetry(
  url: string,
  options: FetchSegmentOptions = {}
): Promise<SegmentFetchResult> {
  const policy = options.policy ?? SEGMENT_RETRY_POLICY;
  const attempts = Math.max(1, Math.floor(policy.attempts));
  const sleep = options.sleep ?? defaultSleep;
  const doFetch = options.fetchImpl ?? fetch;

  let last: SegmentFetchResult = { ok: false, reason: 'network' };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) {
      return { ok: false, reason: 'aborted' };
    }

    const startedAt = Date.now();

    try {
      const response = await doFetch(url, {
        signal: options.signal,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        last = { ok: false, reason: 'http', status: response.status };

        // 确定性失败 or 次数用尽：直接返回
        if (!retryable || attempt >= attempts) return last;

        const delayMs = delayForAttempt(policy, attempt);
        options.onRetry?.({
          attempt,
          delayMs,
          reason: 'http',
          status: response.status,
        });
        await sleep(delayMs);
        continue;
      }

      // 状态 200 但读取 body 失败也是网络问题（连接中途断开），值得重试
      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch (err) {
        if (options.signal?.aborted) {
          return { ok: false, reason: 'aborted' };
        }
        last = { ok: false, reason: 'network' };
        if (attempt >= attempts) return last;

        const delayMs = delayForAttempt(policy, attempt);
        options.onRetry?.({ attempt, delayMs, reason: 'network' });
        await sleep(delayMs);
        void err;
        continue;
      }

      return {
        ok: true,
        buffer,
        contentType: response.headers.get('Content-Type'),
        // 只统计最后一次尝试的耗时：把失败的那些也算进来，
        // 会把带宽估计算得偏低（配合 4.6.4 的封顶，宁可低估不要虚高）
        costMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (err) {
      // abort 不重试：调用方要的是「停止」
      if (
        options.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return { ok: false, reason: 'aborted' };
      }

      last = { ok: false, reason: 'network' };
      if (attempt >= attempts) return last;

      const delayMs = delayForAttempt(policy, attempt);
      options.onRetry?.({ attempt, delayMs, reason: 'network' });
      await sleep(delayMs);
    }
  }

  return last;
}
