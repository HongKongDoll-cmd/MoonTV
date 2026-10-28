/**
 * 预取并发档位（4.7.4）。
 *
 * 背景：预取和播放器**抢同一条家庭宽带**。并发开大，缓存确实追得快，
 * 但播放器要的分片也被挤在同一条队列里 —— 4.6.4 就是从这个角度把并发
 * 从 3 降到 2 的。可反过来，一律钉死 2 又让强设备/好网络白白慢下去，
 * 一集两小时的片子要追很久。
 *
 * 所以做成三档 + 自动：
 * - **low(2)**：弱设备、弱网、省流量模式
 * - **medium(4)**：强设备 + 4G 以上
 * - **high(8)**：只能手动选。自动判定**故意不给 high** ——
 *   判断错一次就是播放跟着卡，代价比"缓存慢一点"大得多
 *
 * `auto` 的判定门槛定得偏高（内存 ≥8GB **且** 核心 ≥8 **且** 非省流量），
 * 为的是让绝大多数手机继续落在 low(2)，不把 4.6.4 的优化又抵消掉。
 */

export type CacheConcurrencyPreset = 'auto' | 'low' | 'medium' | 'high';

/** 自动判定能落到的档位（不含 auto 与 high） */
export type ResolvedConcurrencyPreset = 'low' | 'medium' | 'high';

/** 各档位对应的并发数 */
export const PRESET_CONCURRENCY: Record<ResolvedConcurrencyPreset, number> = {
  low: 2,
  medium: 4,
  high: 8,
};

/** 并发硬上限：再多就是拿播放带宽换缓存速度，得不偿失 */
export const MAX_CONCURRENCY = PRESET_CONCURRENCY.high;

/** 默认并发（设备信息一概拿不到时用这个） */
export const DEFAULT_CONCURRENCY = PRESET_CONCURRENCY.low;

export function isConcurrencyPreset(
  value: unknown
): value is CacheConcurrencyPreset {
  return (
    value === 'auto' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high'
  );
}

export const CONCURRENCY_PRESET_OPTIONS: {
  value: CacheConcurrencyPreset;
  label: string;
  hint: string;
}[] = [
  { value: 'auto', label: '自动', hint: '按设备性能与网络自动选择' },
  { value: 'low', label: '低 (2)', hint: '最不抢播放带宽，适合弱网' },
  { value: 'medium', label: '中 (4)', hint: '强设备 / 好网络' },
  { value: 'high', label: '高 (8)', hint: '缓存最快，但可能影响播放流畅度' },
];

/** 判定自动档位所需的设备画像（便于单测，不直接读 navigator） */
export interface DeviceProfile {
  /** navigator.deviceMemory（GB，浏览器会取整成 0.25/0.5/1/2/4/8） */
  deviceMemory?: number;
  /** navigator.hardwareConcurrency */
  hardwareConcurrency?: number;
  /** navigator.connection.effectiveType */
  effectiveType?: string;
  /** navigator.connection.saveData */
  saveData?: boolean;
}

/** 自动档位的门槛，集中在一处便于调整 */
export const AUTO_THRESHOLDS = {
  /** 低于这个内存（GB）算低端 */
  minMemoryGb: 8,
  /** 多于这个核心数才算强 CPU */
  minCores: 8,
} as const;

const WEAK_NETWORKS = new Set(['slow-2g', '2g', '3g']);

/**
 * 按设备画像决定自动档位。
 *
 * 一律「宁可慢，不要卡」：拿不准的时候落到 low。
 */
export function resolveAutoPreset(
  profile: DeviceProfile = {}
): ResolvedConcurrencyPreset {
  const { deviceMemory, hardwareConcurrency, effectiveType, saveData } = profile;

  // 用户主动开了省流量：别再往死里下
  if (saveData) return 'low';

  // 网络类型拿不到时不当作"好网络"，也不当作"坏网络"，交给后续判据
  if (effectiveType && WEAK_NETWORKS.has(effectiveType)) return 'low';

  // 内存能拿到就必须够大；拿不到（Safari 没这个 API）视作不满足
  if (typeof deviceMemory !== 'number' || deviceMemory < AUTO_THRESHOLDS.minMemoryGb) {
    return 'low';
  }
  if (
    typeof hardwareConcurrency !== 'number' ||
    hardwareConcurrency < AUTO_THRESHOLDS.minCores
  ) {
    return 'low';
  }

  return 'medium';
}

/**
 * 从浏览器读设备画像。
 *
 * SSR 或老浏览器上这些 API 大多不存在，取不到就留 undefined，
 * 由 {@link resolveAutoPreset} 的回退规则处理（结果是 low）。
 */
export function readDeviceProfile(): DeviceProfile {
  if (typeof navigator === 'undefined') return {};

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; saveData?: boolean };
  };

  return {
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    effectiveType: nav.connection?.effectiveType,
    saveData: nav.connection?.saveData,
  };
}

/** 档位 → 并发数；传入的是档位而不是数字，避免非法值流进预取器 */
export function concurrencyForPreset(
  preset: CacheConcurrencyPreset
): number {
  if (preset === 'low' || preset === 'medium' || preset === 'high') {
    return PRESET_CONCURRENCY[preset];
  }
  // auto 或脏值
  return PRESET_CONCURRENCY[resolveAutoPreset(readDeviceProfile())];
}

/**
 * 从缓存设置解析出实际并发数。
 *
 * 单独抽出来是因为调用点有好几处（当前集预取、下一集预热），
 * 每处都写一遍 `concurrencyForPreset(loadCacheSettings().concurrencyPreset)`
 * 很容易漏改一处。
 */
export function resolvePrefetchConcurrency(
  settings?: { concurrencyPreset?: CacheConcurrencyPreset } | null
): number {
  const preset = settings?.concurrencyPreset ?? 'auto';
  return concurrencyForPreset(preset);
}

/** 档位的中文名，用于设置面板回显 */
export function describeConcurrencyPreset(
  preset: CacheConcurrencyPreset
): string {
  if (preset === 'auto') {
    return `自动 (${PRESET_CONCURRENCY[resolveAutoPreset(readDeviceProfile())]})`;
  }
  return CONCURRENCY_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? '自动';
}

/**
 * 把历史/外部写入的数字并发映射到最近档位（4.7.4 迁移用）。
 *
 * 本项目此前没有持久化 concurrency 字段，但配置可能被旧版本或手改写过，
 * 直接丢弃不如就近映射 —— 用户当时的意图至少能被保住一部分。
 */
export function presetFromLegacyConcurrency(
  value: unknown
): CacheConcurrencyPreset | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value <= 2) return 'low';
  if (value <= 4) return 'medium';
  return 'high';
}
