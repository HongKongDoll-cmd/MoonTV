import {
  decideDownshift,
  DOWNSHIFT_EXHAUSTED_KEY,
  downshiftNoticeKey,
  LEVEL_SWITCH_GUARD_MS,
  recordStall,
  SEEK_GUARD_MS,
  STALL_MIN_INTERVAL_MS,
  STALL_THRESHOLD,
  STALL_WINDOW_MS,
} from '../adaptive-quality';

const NO_GUARDS = { lastSeekAt: null, lastLevelSwitchAt: null };

describe('recordStall', () => {
  test('正常追加一次卡顿', () => {
    const out = recordStall([], 10_000, NO_GUARDS);
    expect(out).toEqual([10_000]);
  });

  test('距上次不足 5 秒的重复 waiting 不计入', () => {
    const out = recordStall([10_000], 10_000 + STALL_MIN_INTERVAL_MS - 1, NO_GUARDS);
    expect(out).toEqual([10_000]);
  });

  test('刚好 5 秒算一次新的', () => {
    const out = recordStall([10_000], 10_000 + STALL_MIN_INTERVAL_MS, NO_GUARDS);
    expect(out).toEqual([10_000, 15_000]);
  });

  test('拖动保护窗口内的 waiting 不计入（这是 4.7.3 的核心修复）', () => {
    const out = recordStall([], 20_000, {
      lastSeekAt: 20_000 - SEEK_GUARD_MS + 1,
      lastLevelSwitchAt: null,
    });
    expect(out).toEqual([]);
  });

  test('拖动保护窗口结束后恢复记录', () => {
    const out = recordStall([], 20_000, {
      lastSeekAt: 20_000 - SEEK_GUARD_MS,
      lastLevelSwitchAt: null,
    });
    expect(out).toEqual([20_000]);
  });

  test('换档保护窗口内的 waiting 不计入', () => {
    const out = recordStall([], 30_000, {
      lastSeekAt: null,
      lastLevelSwitchAt: 30_000 - LEVEL_SWITCH_GUARD_MS + 500,
    });
    expect(out).toEqual([]);
  });

  test('超出统计窗口的旧记录被清掉', () => {
    const now = 200_000;
    // 第二条要距 now 至少 STALL_MIN_INTERVAL_MS，否则会先被去重逻辑挡掉
    const recent = now - STALL_MIN_INTERVAL_MS;
    const out = recordStall([now - STALL_WINDOW_MS - 1, recent], now, NO_GUARDS);
    expect(out).toEqual([recent, now]);
  });

  test('被忽略时返回原数组引用（调用方可据此跳过后续处理）', () => {
    const input = [10_000];
    const out = recordStall(input, 10_500, NO_GUARDS);
    expect(out).toBe(input);
  });
});

describe('decideDownshift', () => {
  const stalls = (n: number) =>
    Array.from({ length: n }, (_, i) => 1000 + i * 10_000);

  test('卡顿次数不足阈值：不动', () => {
    const d = decideDownshift(stalls(STALL_THRESHOLD - 1), 3, Infinity);
    expect(d).toEqual({ action: 'ignore', reason: 'not-enough-stalls' });
  });

  test('达到阈值：上限压一档', () => {
    const d = decideDownshift(stalls(STALL_THRESHOLD), 3, Infinity);
    expect(d).toEqual({ action: 'downshift', nextCap: 2 });
  });

  test('当前已在最低档：提示换源（exhausted），不做无意义降档', () => {
    // cap 已经压到 0
    expect(decideDownshift(stalls(STALL_THRESHOLD), 0, 0)).toEqual({
      action: 'exhausted',
    });
  });

  test('档位未知（-1）时不猜，避免把本来能播的档位压掉', () => {
    const d = decideDownshift(stalls(STALL_THRESHOLD), -1, Infinity);
    expect(d).toEqual({ action: 'ignore', reason: 'unknown-level' });
  });

  test('当前播放档位低于已有上限：压不动，视为到底', () => {
    // 上限 1，当前播 0 —— 再压还是 0
    const d = decideDownshift(stalls(STALL_THRESHOLD), 0, 1);
    expect(d).toEqual({ action: 'exhausted' });
  });

  test('一开始就在最低档（0）：压不出效果，直接提示换源', () => {
    expect(decideDownshift(stalls(STALL_THRESHOLD), 0, Infinity)).toEqual({
      action: 'exhausted',
    });
  });

  test('连续降档：3 → 2 → 1 → 0，然后到底', () => {
    expect(decideDownshift(stalls(4), 3, Infinity)).toEqual({
      action: 'downshift',
      nextCap: 2,
    });
    expect(decideDownshift(stalls(4), 2, 2)).toEqual({
      action: 'downshift',
      nextCap: 1,
    });
    expect(decideDownshift(stalls(4), 1, 1)).toEqual({
      action: 'downshift',
      nextCap: 0,
    });
    expect(decideDownshift(stalls(4), 0, 0)).toEqual({ action: 'exhausted' });
  });

  test('播放档位高于上限时以上限为准', () => {
    // 上限 1，但 loadLevel 报 3（正在切换）→ 应在 1 的基础上再压
    const d = decideDownshift(stalls(4), 3, 1);
    expect(d).toEqual({ action: 'downshift', nextCap: 0 });
  });
});

describe('提示 key', () => {
  test('不同档位有不同 key（同一档位只提示一次）', () => {
    expect(downshiftNoticeKey(2)).toBe('cap-2');
    expect(downshiftNoticeKey(1)).not.toBe(downshiftNoticeKey(2));
  });

  test('「已到最低档」的 key 不会与档位 key 撞', () => {
    expect(DOWNSHIFT_EXHAUSTED_KEY).toBe('min');
    expect(downshiftNoticeKey(0)).not.toBe(DOWNSHIFT_EXHAUSTED_KEY);
  });
});
