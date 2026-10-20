
/**
 * 弹幕限流：**抽稀**而不是丢弃整批。
 *
 * 为什么要它：采集站一集弹幕经常几千条，且高峰时段（片头/名场面）密度极高。
 * 全部灌进插件会同时出现两件事：
 *   1. DOM 元素暴涨 → 主线程掉帧、播放卡顿；
 *   2. `config({danmaku})` 是全量重建，列表越长重建越久，切集时尤其明显。
 *
 * 限流策略（两条同时生效）：
 *   1. **按秒抽稀**：同一秒内超过 `maxPerSecond` 条时等距取样。
 *      名场面一秒钟几十条，屏幕根本放不下，等距取前若干条观感最好。
 *   2. **总量抽稀**：整集超过 `maxTotal` 条时全局等距取样。
 *
 * 两个硬约束：
 *   - **保持时序**：弹幕必须按 `time` 升序渲染，抽样只能挑选、不能重排。
 *   - **等距而非截断**：直接 `slice(0, N)` 会让前几分钟刷屏、后面全空；
 *     等距取样让密度均匀分布。
 */

export interface DanmakuThrottleOptions {
  /** 同一秒内最多保留几条 */
  maxPerSecond?: number;
  /** 单集弹幕总数上限 */
  maxTotal?: number;
}

export const DEFAULT_DANMAKU_THROTTLE = {
  maxPerSecond: 10,
  maxTotal: 600,
} as const;

/**
 * 等距取样：保持原顺序，且**首尾必定保留**。
 *
 * 用 `round(i * (len-1) / (max-1))` 而不是 `floor(i * len/max)`：
 * 后者取 30 条里的 10 条时最后一个是下标 27，末位附近全丢；
 * 前者能让该秒最早与最晚的弹幕都留下来，中间均匀摊开。
 */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  if (items.length <= max) return items;
  if (max === 1) return [items[0]];

  const out: T[] = [];
  const span = items.length - 1;
  for (let i = 0; i < max; i++) {
    out.push(items[Math.round((i * span) / (max - 1))]);
  }
  return out;
}

/**
 * 抽稀一组弹幕。
 *
 * 泛型只依赖 `time` 字段：项目里有两种弹幕结构（`DanmakuItem` 与插件用的
 * `PluginDanmakuItem`，后者没有 `type`），两者都能直接用同一个函数处理。
 *
 * 纯函数：不修改入参，返回新数组；输入非法时返回空数组。
 *
 * @param items 弹幕列表（`time` 单位为秒，可为小数）
 */
export function throttleDanmaku<T extends { time: number }>(
  items: T[] | null | undefined,
  options: DanmakuThrottleOptions = {}
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const maxPerSecond =
    options.maxPerSecond ?? DEFAULT_DANMAKU_THROTTLE.maxPerSecond;
  const maxTotal = options.maxTotal ?? DEFAULT_DANMAKU_THROTTLE.maxTotal;

  // 1) 按秒分桶抽稀。桶 key 用 floor(time)，负数时间归到第 0 桶。
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    if (!item || typeof item.time !== 'number' || !Number.isFinite(item.time)) {
      continue;
    }
    const key = Math.max(0, Math.floor(item.time));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  // 桶按时间升序输出，保证时序
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const perSecond: T[] = [];
  for (const key of keys) {
    // key 来自 buckets 自身，get 必有值；缺省分支只为满足类型
    const bucket = buckets.get(key) ?? [];
    if (bucket.length > maxPerSecond) {
      perSecond.push(...sampleEvenly(bucket, maxPerSecond));
    } else {
      perSecond.push(...bucket);
    }
  }

  // 2) 总量抽稀（此时 perSecond 已是有序的）
  if (perSecond.length > maxTotal) {
    return sampleEvenly(perSecond, maxTotal);
  }
  return perSecond;
}

/** 限流统计，用于在 UI 上提示"已抽稀 N 条" */
export interface DanmakuThrottleStats {
  original: number;
  kept: number;
  dropped: number;
}

export function describeDanmakuThrottle<T>(
  original: T[] | null | undefined,
  result: T[]
): DanmakuThrottleStats {
  const total = Array.isArray(original) ? original.length : 0;
  return {
    original: total,
    kept: result.length,
    dropped: Math.max(0, total - result.length),
  };
}
