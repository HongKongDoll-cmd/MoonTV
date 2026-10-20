import {
  buildCachedStats,
  MAX_CACHED_BW_ESTIMATE,
} from '@/app/play/play-utils';

describe('buildCachedStats（4.6.4 缓存命中时的 ABR 带宽估算）', () => {
  test('正常耗时下带宽估算接近真实值', () => {
    // 2MB / 200ms = 10MB/s = 80Mbps，未超 25Mbps 上限时应按原值上报
    const stats = buildCachedStats(200, 2 * 1024 * 1024);
    const bw = stats.bwEstimate as number;
    expect(bw).toBeGreaterThan(0);
    expect(bw).toBeLessThanOrEqual(MAX_CACHED_BW_ESTIMATE);
  });

  test('闲时预取的极低耗时被截断，不会把 ABR 骗到高档', () => {
    // 复现真实 bug：1MB 分片在闲时 20ms 下完 → 算出 400Mbps 以上的虚高值
    const stats = buildCachedStats(20, 1024 * 1024);
    expect(stats.bwEstimate as number).toBeLessThanOrEqual(
      MAX_CACHED_BW_ESTIMATE
    );
  });

  test('bwEstimate 与 loading 时长自洽（ABR 会同时读这两个字段）', () => {
    const stats = buildCachedStats(20, 1024 * 1024);
    const loading = stats.loading as { start: number; end: number };
    const size = 1024 * 1024;
    const span = loading.end - loading.start;
    // 由 loading 时长反算出来的带宽必须等于上报的 bwEstimate
    expect((size / span) * 1000).toBeCloseTo(stats.bwEstimate as number, 5);
  });

  test('上限值就是 25Mbps', () => {
    expect(MAX_CACHED_BW_ESTIMATE).toBe((25 * 1000 * 1000) / 8);
  });

  test('耗时 0 也不会除零（bwEstimate 仍为有限值）', () => {
    const stats = buildCachedStats(0, 1024 * 1024);
    expect(Number.isFinite(stats.bwEstimate as number)).toBe(true);
    expect(stats.bwEstimate as number).toBeLessThanOrEqual(
      MAX_CACHED_BW_ESTIMATE
    );
  });

  test('bytes 为 0 时不除零、不上报 NaN', () => {
    const stats = buildCachedStats(100, 0);
    expect(Number.isFinite(stats.bwEstimate as number)).toBe(true);
    expect(stats.loaded as number).toBe(1);
  });

  test('纯函数：不依赖外部状态，同样输入得到同样上限', () => {
    const a = buildCachedStats(5, 1024 * 1024);
    const b = buildCachedStats(5, 1024 * 1024);
    expect(a.bwEstimate).toBe(b.bwEstimate);
  });
});
