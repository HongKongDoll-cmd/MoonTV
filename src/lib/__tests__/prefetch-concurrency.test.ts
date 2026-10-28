import {
  AUTO_THRESHOLDS,
  CONCURRENCY_PRESET_OPTIONS,
  concurrencyForPreset,
  DEFAULT_CONCURRENCY,
  describeConcurrencyPreset,
  isConcurrencyPreset,
  MAX_CONCURRENCY,
  PRESET_CONCURRENCY,
  presetFromLegacyConcurrency,
  resolveAutoPreset,
  resolvePrefetchConcurrency,
} from '../prefetch-concurrency';
import { normalizeCacheSettings } from '../video-cache';

/** 一台上限设备：8G 内存 + 16 核 + 4G */
const STRONG = {
  deviceMemory: 8,
  hardwareConcurrency: 16,
  effectiveType: '4g',
};

describe('档位与并发数', () => {
  test('三档并发为 2 / 4 / 8，且上限等于最高档', () => {
    expect(PRESET_CONCURRENCY).toEqual({ low: 2, medium: 4, high: 8 });
    expect(MAX_CONCURRENCY).toBe(PRESET_CONCURRENCY.high);
  });

  test('默认并发等于低档（拿不准设备时不要擅自加大并发）', () => {
    expect(DEFAULT_CONCURRENCY).toBe(PRESET_CONCURRENCY.low);
  });

  test('选项列表覆盖全部四个值（漏一个就选不到）', () => {
    expect(CONCURRENCY_PRESET_OPTIONS.map((o) => o.value).sort()).toEqual([
      'auto',
      'high',
      'low',
      'medium',
    ]);
  });

  test('固定档位不受设备影响', () => {
    expect(concurrencyForPreset('high')).toBe(8);
    expect(concurrencyForPreset('medium')).toBe(4);
    expect(concurrencyForPreset('low')).toBe(2);
  });

  test('isConcurrencyPreset 只认四个值', () => {
    expect(isConcurrencyPreset('auto')).toBe(true);
    expect(isConcurrencyPreset('high')).toBe(true);
    expect(isConcurrencyPreset('AUTO')).toBe(false);
    expect(isConcurrencyPreset(4)).toBe(false);
    expect(isConcurrencyPreset(undefined)).toBe(false);
  });
});

describe('resolveAutoPreset', () => {
  test('强设备 + 4G → 中档', () => {
    expect(resolveAutoPreset(STRONG)).toBe('medium');
  });

  test('自动判定永远不会给出高档（判错一次就是播放跟着卡）', () => {
    const cases = [
      STRONG,
      { ...STRONG, deviceMemory: 32, hardwareConcurrency: 64 },
      {},
      { deviceMemory: 2, hardwareConcurrency: 2, effectiveType: '2g' },
    ];
    for (const c of cases) {
      expect(resolveAutoPreset(c)).not.toBe('high');
    }
  });

  test('省流量模式一律低档', () => {
    expect(resolveAutoPreset({ ...STRONG, saveData: true })).toBe('low');
  });

  test('弱网络一律低档', () => {
    for (const effectiveType of ['slow-2g', '2g', '3g']) {
      expect(resolveAutoPreset({ ...STRONG, effectiveType })).toBe('low');
    }
  });

  test('内存不足低档', () => {
    expect(
      resolveAutoPreset({ ...STRONG, deviceMemory: AUTO_THRESHOLDS.minMemoryGb - 1 })
    ).toBe('low');
  });

  test('内存 API 缺失（Safari）按不满足处理 → 低档', () => {
    expect(
      resolveAutoPreset({ hardwareConcurrency: 16, effectiveType: '4g' })
    ).toBe('low');
  });

  test('核心数不足低档', () => {
    expect(
      resolveAutoPreset({ ...STRONG, hardwareConcurrency: AUTO_THRESHOLDS.minCores - 1 })
    ).toBe('low');
  });

  test('核心数 API 缺失 → 低档', () => {
    expect(resolveAutoPreset({ deviceMemory: 8, effectiveType: '4g' })).toBe(
      'low'
    );
  });

  test('完全拿不到设备信息 → 低档', () => {
    expect(resolveAutoPreset()).toBe('low');
    expect(resolveAutoPreset({})).toBe('low');
  });

  test('刚好达到门槛算强设备', () => {
    expect(
      resolveAutoPreset({
        deviceMemory: AUTO_THRESHOLDS.minMemoryGb,
        hardwareConcurrency: AUTO_THRESHOLDS.minCores,
        effectiveType: '4g',
      })
    ).toBe('medium');
  });

  test('网络类型未知时不因此降档（仍看内存与核心数）', () => {
    expect(resolveAutoPreset({ ...STRONG, effectiveType: undefined })).toBe(
      'medium'
    );
  });
});

describe('历史配置迁移', () => {
  test('数字并发就近映射到档位', () => {
    expect(presetFromLegacyConcurrency(1)).toBe('low');
    expect(presetFromLegacyConcurrency(2)).toBe('low');
    expect(presetFromLegacyConcurrency(3)).toBe('medium');
    expect(presetFromLegacyConcurrency(4)).toBe('medium');
    expect(presetFromLegacyConcurrency(6)).toBe('high');
    expect(presetFromLegacyConcurrency(32)).toBe('high');
  });

  test('非法值返回 undefined（调用方保持默认）', () => {
    expect(presetFromLegacyConcurrency('4')).toBeUndefined();
    expect(presetFromLegacyConcurrency(null)).toBeUndefined();
    expect(presetFromLegacyConcurrency(Number.NaN)).toBeUndefined();
  });
});

describe('resolvePrefetchConcurrency', () => {
  test('设置缺失时按 auto 处理（jsdom 无设备信息 → 低档）', () => {
    expect(resolvePrefetchConcurrency()).toBe(PRESET_CONCURRENCY.low);
    expect(resolvePrefetchConcurrency(null)).toBe(PRESET_CONCURRENCY.low);
    expect(resolvePrefetchConcurrency({})).toBe(PRESET_CONCURRENCY.low);
  });

  test('显式档位直接生效', () => {
    expect(resolvePrefetchConcurrency({ concurrencyPreset: 'high' })).toBe(8);
    expect(resolvePrefetchConcurrency({ concurrencyPreset: 'medium' })).toBe(4);
  });
});

describe('describeConcurrencyPreset', () => {
  test('固定档位返回带数字的标签', () => {
    expect(describeConcurrencyPreset('low')).toContain('2');
    expect(describeConcurrencyPreset('medium')).toContain('4');
    expect(describeConcurrencyPreset('high')).toContain('8');
  });

  test('auto 会带出实际解析到的并发数', () => {
    expect(describeConcurrencyPreset('auto')).toMatch(/自动 \(\d+\)/);
  });
});

describe('缓存设置里的并发档位（normalize）', () => {
  test('没配置过时默认 auto', () => {
    expect(normalizeCacheSettings({}).concurrencyPreset).toBe('auto');
  });

  test('合法档位原样保留', () => {
    expect(
      normalizeCacheSettings({ concurrencyPreset: 'high' }).concurrencyPreset
    ).toBe('high');
  });

  test('旧配置里的数字并发被就近迁移（不让用户的意图凭空消失）', () => {
    expect(normalizeCacheSettings({ concurrency: 2 }).concurrencyPreset).toBe(
      'low'
    );
    expect(normalizeCacheSettings({ concurrency: 4 }).concurrencyPreset).toBe(
      'medium'
    );
    expect(normalizeCacheSettings({ concurrency: 9 }).concurrencyPreset).toBe(
      'high'
    );
  });

  test('新字段优先于旧数字', () => {
    expect(
      normalizeCacheSettings({ concurrencyPreset: 'low', concurrency: 8 })
        .concurrencyPreset
    ).toBe('low');
  });

  test('脏值回退到 auto', () => {
    expect(
      normalizeCacheSettings({ concurrencyPreset: 'turbo' }).concurrencyPreset
    ).toBe('auto');
    expect(
      normalizeCacheSettings({ concurrency: 'many' }).concurrencyPreset
    ).toBe('auto');
  });
});
