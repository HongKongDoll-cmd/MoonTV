import {
  applyBufferBudget,
  BUFFER_BYTES_SAFETY,
  BUFFER_FALLBACK,
  BUFFER_SIZE_MAX,
  BUFFER_SIZE_MIN,
  BUFFER_TARGET_SECONDS,
  clampBudgetToFloor,
  computeBufferBudget,
  readLevelBitrate,
} from '@/app/play/play-utils';

describe('computeBufferBudget', () => {
  test('8Mbps × 120s 正好回到 4.6.4 手动调的 150MB（公式量级校验）', () => {
    const budget = computeBufferBudget(8_000_000);
    expect(budget.maxBufferSize).toBe(150 * 1000 * 1000);
    expect(budget.maxBufferLength).toBe(BUFFER_TARGET_SECONDS);
  });

  test('低码率撞下限：不能因为码率低就把缓冲砍到装不满', () => {
    const budget = computeBufferBudget(800_000); // 800kbps
    expect(budget.maxBufferSize).toBe(BUFFER_SIZE_MIN);
  });

  test('高码率按比例放大：15Mbps 需要 225MB 以上才装得下 120s', () => {
    const budget = computeBufferBudget(15_000_000);
    // 15e6 * 120 * 1.25 / 8 = 281.25MB
    expect(budget.maxBufferSize).toBe(Math.round((15_000_000 * 120 * BUFFER_BYTES_SAFETY) / 8));
    expect(budget.maxBufferSize).toBeGreaterThan(225 * 1000 * 1000);
  });

  test('极高码率撞上限：移动端不能被算到爆内存', () => {
    const budget = computeBufferBudget(80_000_000); // 80Mbps
    expect(budget.maxBufferSize).toBe(BUFFER_SIZE_MAX);
  });

  test('码率未知时给兜底预算，不按猜的数字缩小缓冲', () => {
    for (const bad of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const budget = computeBufferBudget(bad as number | null | undefined);
      expect(budget.maxBufferSize).toBe(BUFFER_FALLBACK.maxBufferSize);
      expect(budget.maxBufferLength).toBe(BUFFER_TARGET_SECONDS);
      expect(budget.backBufferLength).toBe(BUFFER_FALLBACK.backBufferLength);
    }
  });

  test('目标时长被钳制在 30~300 秒之间', () => {
    expect(computeBufferBudget(8_000_000, { targetSeconds: 5 }).maxBufferLength).toBe(30);
    expect(computeBufferBudget(8_000_000, { targetSeconds: 999 }).maxBufferLength).toBe(300);
    expect(computeBufferBudget(8_000_000, { targetSeconds: 60 }).maxBufferLength).toBe(60);
  });

  test('回看时长随目标时长缩放，且限制在 10~30 秒', () => {
    expect(computeBufferBudget(8_000_000, { targetSeconds: 120 }).backBufferLength).toBe(30);
    expect(computeBufferBudget(8_000_000, { targetSeconds: 60 }).backBufferLength).toBe(15);
    expect(computeBufferBudget(8_000_000, { targetSeconds: 30 }).backBufferLength).toBe(10);
    expect(computeBufferBudget(8_000_000, { targetSeconds: 300 }).backBufferLength).toBe(30);
  });

  test('码率越高字节预算越大（单调性）', () => {
    const low = computeBufferBudget(2_000_000).maxBufferSize;
    const mid = computeBufferBudget(8_000_000).maxBufferSize;
    const high = computeBufferBudget(20_000_000).maxBufferSize;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe('clampBudgetToFloor', () => {
  const base = { maxBufferSize: 300, maxBufferLength: 120, backBufferLength: 30 };

  test('没降级过时原样返回', () => {
    expect(clampBudgetToFloor(base, null)).toEqual(base);
    expect(clampBudgetToFloor(base, undefined)).toEqual(base);
  });

  test('与已降级的预算取更紧的那个（换档不能把降级结果弹回去）', () => {
    const shrunk = { maxBufferSize: 100, maxBufferLength: 60, backBufferLength: 20 };
    expect(clampBudgetToFloor(base, shrunk)).toEqual(shrunk);
  });

  test('逐字段取小值，不是整组覆盖', () => {
    const mixed = { maxBufferSize: 500, maxBufferLength: 50, backBufferLength: 90 };
    expect(clampBudgetToFloor(base, mixed)).toEqual({
      maxBufferSize: 300, // base 更小
      maxBufferLength: 50, // shrunk 更小
      backBufferLength: 30, // base 更小
    });
  });
});

describe('readLevelBitrate', () => {
  test('优先读解析后的 bitrate', () => {
    expect(readLevelBitrate({ bitrate: 5_000_000, attrs: { BANDWIDTH: 9 } })).toBe(5_000_000);
  });

  test('没有 bitrate 时读 master playlist 的 BANDWIDTH', () => {
    expect(readLevelBitrate({ attrs: { BANDWIDTH: 3_000_000 } })).toBe(3_000_000);
  });

  test('BANDWIDTH 是字符串也能解析', () => {
    expect(readLevelBitrate({ attrs: { BANDWIDTH: '2500000' } })).toBe(2_500_000);
  });

  test('都拿不到时返回 null（交给兜底预算）', () => {
    expect(readLevelBitrate(null)).toBeNull();
    expect(readLevelBitrate(undefined)).toBeNull();
    expect(readLevelBitrate({})).toBeNull();
    expect(readLevelBitrate({ bitrate: 0 })).toBeNull();
    expect(readLevelBitrate({ attrs: { BANDWIDTH: 'abc' } })).toBeNull();
  });

  test('非法 bitrate 会退到 BANDWIDTH', () => {
    expect(readLevelBitrate({ bitrate: -1, attrs: { BANDWIDTH: 4_000_000 } })).toBe(4_000_000);
  });
});

describe('applyBufferBudget', () => {
  test('就地写回三个字段', () => {
    const config = { maxBufferSize: 1, maxBufferLength: 2, backBufferLength: 3 };
    applyBufferBudget(config, {
      maxBufferSize: 150 * 1000 * 1000,
      maxBufferLength: 120,
      backBufferLength: 30,
    });
    expect(config).toEqual({
      maxBufferSize: 150 * 1000 * 1000,
      maxBufferLength: 120,
      backBufferLength: 30,
    });
  });
});
