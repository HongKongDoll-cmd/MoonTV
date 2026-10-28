/**
 * 弱网自动降档的判定逻辑（4.7.3）。
 *
 * 原来这段埋在 `video:waiting` 的回调里，既不好测，也有一个真实的误判：
 * **拖动进度条也会触发 waiting** —— 拖到一个还没缓冲的位置，必然卡一下。
 * 拖三次就是三次「卡顿」，于是阈值一满就把画质降了，而网络其实好得很。
 * 切换画质同理：切到高档要重新缓冲，那一下的 waiting 更不该算进"网络不行"。
 *
 * 所以拆成两个纯函数，把「该不该记一次卡顿」和「该不该降档」分开：
 *
 * 1. {@link recordStall} —— 决定这次 waiting 要不要计入卡顿统计
 *    （保护窗口内不计、5 秒内重复不计、超窗口的旧记录清掉）
 * 2. {@link decideDownshift} —— 根据统计结果给出动作
 *
 * 分开的好处是保护窗口作用于**记录**这一步，而不只是"判定"：
 * 只挡判定的话，拖动产生的 waiting 仍然会堆进数组，
 * 等用户正常看几分钟、攒够阈值，照样会被误降档。
 */

/** 卡顿统计窗口：只看最近 2 分钟 */
export const STALL_WINDOW_MS = 120_000;

/** 两次卡顿的最小间隔：waiting 会连发，5 秒内的只记一次 */
export const STALL_MIN_INTERVAL_MS = 5_000;

/** 窗口内累计多少次才算网络真的跟不上 */
export const STALL_THRESHOLD = 4;

/**
 * 拖动后的保护窗口。
 *
 * 拖到未缓冲位置必然 waiting，且可能连续触发多次。
 * 4 秒足够覆盖「seek → 缓冲 → 首帧 → playing」这一整段。
 */
export const SEEK_GUARD_MS = 4_000;

/**
 * 手动切换画质后的保护窗口。
 *
 * 换到高档位要重新填充缓冲区，这期间的卡顿是换档的代价而不是网络问题。
 * 比 seek 短一点：3 秒后如果还在卡，那就是真的跟不上。
 */
export const LEVEL_SWITCH_GUARD_MS = 3_000;

export interface StallGuards {
  /** 最近一次拖动（seek）的时间戳 */
  lastSeekAt: number | null;
  /** 最近一次手动切换画质的时间戳 */
  lastLevelSwitchAt: number | null;
}

/**
 * 记录一次卡顿，返回**新的**统计数组。
 *
 * 会被忽略的三种情况（返回原数组，调用方可用引用比较判断没变化）：
 * - 处于拖动保护窗口内
 * - 处于换档保护窗口内
 * - 距上次记录不足 {@link STALL_MIN_INTERVAL_MS}
 *
 * 另外会把超出统计窗口的旧记录清掉，避免数组无限增长。
 *
 * @param stallTimes 现有记录（毫秒时间戳，升序）
 */
export function recordStall(
  stallTimes: number[],
  now: number,
  guards: StallGuards = { lastSeekAt: null, lastLevelSwitchAt: null }
): number[] {
  const { lastSeekAt, lastLevelSwitchAt } = guards;

  // 保护窗口：本次 waiting 是拖动/换档引起的，不该算进网络质量
  if (lastSeekAt !== null && now - lastSeekAt < SEEK_GUARD_MS) {
    return stallTimes;
  }
  if (
    lastLevelSwitchAt !== null &&
    now - lastLevelSwitchAt < LEVEL_SWITCH_GUARD_MS
  ) {
    return stallTimes;
  }

  // 去重：waiting 会连续触发，短时间内只记一次
  const last = stallTimes.length ? stallTimes[stallTimes.length - 1] : null;
  if (last !== null && now - last < STALL_MIN_INTERVAL_MS) {
    return stallTimes;
  }

  const next = [...stallTimes, now];
  // 只保留统计窗口内的
  while (next.length > 0 && now - next[0] > STALL_WINDOW_MS) {
    next.shift();
  }
  return next;
}

export type DownshiftAction = 'downshift' | 'exhausted' | 'ignore';

export type DownshiftDecision =
  | { action: 'downshift'; nextCap: number }
  | { action: 'exhausted' }
  | {
      action: 'ignore';
      reason: 'not-enough-stalls' | 'unknown-level';
    };

/**
 * 根据卡顿统计决定是否降档。
 *
 * @param stallTimes 统计窗口内的卡顿时间戳
 * @param currentLevel 当前播放档位下标；`-1` 表示还不知道
 * @param currentCap 当前 ABR 上限；`Infinity` 表示还没压过
 */
export function decideDownshift(
  stallTimes: number[],
  currentLevel: number,
  currentCap: number
): DownshiftDecision {
  if (stallTimes.length < STALL_THRESHOLD) {
    return { action: 'ignore', reason: 'not-enough-stalls' };
  }

  // 已经压到最低档还在卡：再压没意义，得提示用户换源
  if (currentCap <= 0) return { action: 'exhausted' };

  // 档位未知时不猜：猜错会把用户从一个本来能播的档位压下去
  if (!Number.isFinite(currentLevel) || currentLevel < 0) {
    return { action: 'ignore', reason: 'unknown-level' };
  }

  // 实际生效的档位 = 播放档位与上限中更低的那个
  const effective = Math.min(currentLevel, currentCap);
  const nextCap = Math.max(0, effective - 1);

  /**
   * 压到目标后**不比当前生效档位更低**，说明再压也不会有变化：
   * 典型是「当前已经在最低档（0），上限却还有 1」—— 压是把上限从 1 改到 0，
   * 但用户本来就在播 0，画面不会有任何区别，只该提示换源。
   */
  if (nextCap >= effective) return { action: 'exhausted' };

  return { action: 'downshift', nextCap };
}

/** 降档提示的 key：同一档位只提示一次 */
export function downshiftNoticeKey(nextCap: number): string {
  return `cap-${nextCap}`;
}

/** 「已到最低档仍卡」的提示 key */
export const DOWNSHIFT_EXHAUSTED_KEY = 'min';
