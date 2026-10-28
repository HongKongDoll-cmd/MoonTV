/**
 * 预取写入的串行化与主线程让步（4.7.5）。
 *
 * 为什么下载可以并发、**写入必须串行**：
 *
 * 1. 并发下载只是网络 I/O，彼此不冲突；
 * 2. `cache.put()` 与 IndexedDB 的 `put()` 是**共享资源**。多个 worker 同时写，
 *    Cache Storage 内部会排队、IndexedDB 会反复开事务，反而更慢；
 *    更要紧的是批量写入会长时间占住主线程，用户这时候拖动进度条、
 *    点选集，页面就一顿一顿的 —— 这正是上游说的「批量缓存阻塞页面」。
 *
 * 所以：下载并发不变（那是性能来源），写入串到一条队列上，
 * 并且每写满 {@link WRITE_YIELD_INTERVAL} 个分片主动让出一次主线程，
 * 让点击/滚动/播放这类交互有机会插进来。
 */

/** 每写多少个分片让出一次主线程 */
export const WRITE_YIELD_INTERVAL = 16;

/** 让步实现是否支持 scheduler.yield（Chrome 129+） */
type SchedulerLike = { yield?: () => Promise<void> };

/**
 * 把控制权交回浏览器，让待处理的交互先跑。
 *
 * 三级降级：
 * 1. `scheduler.yield()` —— 语义最准，且不会被 setTimeout 的 4ms 钳制拖慢；
 * 2. `MessageChannel` —— 属于宏任务但**没有**嵌套 setTimeout 的最小延迟，
 *    在支持面更广的前提下代价最小；
 * 3. `setTimeout(0)` —— 兜底。
 */
export function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }

  if (typeof MessageChannel !== 'undefined') {
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export interface SerialQueue {
  /**
   * 把任务排到队尾执行，返回该任务的结果。
   *
   * 前一个任务**失败不影响后续**：队列是为「不并发」服务的，
   * 不是为「一个失败就全停」—— 单个分片写失败就放弃整个队列，
   * 会让剩下的分片全部不缓存。
   */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** 已排队但尚未完成的任务数（含正在执行的），仅用于观测 */
  readonly pending: number;
}

/**
 * 创建一个串行执行队列。
 *
 * 实现是经典的 Promise 链：`tail` 永远指向「最后一个任务的结束」，
 * 新任务挂上去就天然有序。用 `.then(fn, fn)` 而不是 `.then(fn)`，
 * 是为了让前一个任务 reject 时后一个照常开始。
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      pending += 1;
      const result = tail.then(task, task);
      // tail 只用于排队，必须吞掉异常，否则整条链会变成 rejected
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result.finally(() => {
        pending -= 1;
      });
    },
    get pending() {
      return pending;
    },
  };
}
