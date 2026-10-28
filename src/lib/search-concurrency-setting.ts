/**
 * 搜索源并发的客户端设置（4.7.8）。
 *
 * 服务端的并发上限放在 `lib/concurrency-pool.ts`，这里只管「用户在源选择器里
 * 选了几路」。两者职责分开：客户端只负责把值传上去，**真正生效与否由服务端
 * 二次校验决定** —— 本地存储可以被随意改写，不能当作可信输入。
 */

/** localStorage 键 */
export const SEARCH_CONCURRENCY_STORAGE_KEY = 'searchSourceConcurrency';

/** 0 表示「自动」，即不传参、由服务端用环境变量或默认值 */
export const SEARCH_CONCURRENCY_AUTO = 0;

/** 与 lib/concurrency-pool.ts 的上限保持一致，避免前端能选出服务端不认的值 */
export const SEARCH_CONCURRENCY_CLIENT_MAX = 16;

/**
 * 规范化用户设置。
 *
 * - 非数字 / 负数 → 自动（0）
 * - 超过上限 → 上限
 * - 其余取整
 */
export function normalizeSearchConcurrencySetting(raw: unknown): number {
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return SEARCH_CONCURRENCY_AUTO;
  return Math.min(SEARCH_CONCURRENCY_CLIENT_MAX, Math.round(parsed));
}

/** 读本地设置；没设置过或存储不可用时返回「自动」 */
export function loadSearchConcurrencySetting(): number {
  if (typeof window === 'undefined') return SEARCH_CONCURRENCY_AUTO;
  try {
    const raw = window.localStorage.getItem(SEARCH_CONCURRENCY_STORAGE_KEY);
    if (raw === null) return SEARCH_CONCURRENCY_AUTO;
    return normalizeSearchConcurrencySetting(raw);
  } catch {
    return SEARCH_CONCURRENCY_AUTO;
  }
}

/** 写本地设置，返回规范化后的实际值（便于调用方回显） */
export function saveSearchConcurrencySetting(raw: unknown): number {
  const value = normalizeSearchConcurrencySetting(raw);
  if (typeof window === 'undefined') return value;
  try {
    window.localStorage.setItem(
      SEARCH_CONCURRENCY_STORAGE_KEY,
      String(value)
    );
  } catch {
    // 隐私模式写不进去：只是记不住偏好，不影响本次搜索
  }
  return value;
}

/**
 * 转成请求参数值。
 *
 * 返回 `null` 表示**不要带这个参数**（自动模式），让服务端走
 * 环境变量 / 默认值那条路径。带 `0` 上去反而是个负担：
 * 服务端还得再判断一次"0 是不是没设置"。
 */
export function toSearchConcurrencyParam(setting: number): string | null {
  const value = normalizeSearchConcurrencySetting(setting);
  return value > 0 ? String(value) : null;
}
