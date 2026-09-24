/**
 * 豆瓣评分批量补全（纯函数，client-safe）。
 *
 * 背景：搜索结果来自 Apple CMS，条目只带 `douban_id` 没有评分，卡片因此不显示
 * 评分角标（VideoCard 只在豆瓣来源显示）。这里提供「按 douban_id 批量换评分」
 * 的纯逻辑：收集待查 id、清洗外部输入、归一化评分值、把评分合并回条目。
 *
 * 网络请求不在这里：`/api/douban/ratings` 负责服务端抓取，
 * `douban.client.ts` 负责浏览器端调用与缓存。
 */

/** 单批最多查多少个条目（防止一次搜索打爆豆瓣）。 */
export const RATE_LOOKUP_LIMIT = 24;

/** 服务端并发抓取上限。 */
export const RATE_LOOKUP_CONCURRENCY = 4;

/** 单个条目详情请求超时（毫秒）。 */
export const RATE_LOOKUP_TIMEOUT = 8000;

/** 浏览器端整批补全的兜底超时（毫秒）。 */
export const RATE_LOOKUP_CLIENT_TIMEOUT = 12000;

export interface RateLookupCandidate {
  id?: string | number | null;
  rate?: string | null;
}

/**
 * 归一化豆瓣评分。
 *
 * 豆瓣的评分形态有三种：数字 `6.6`、字符串 `"6.6"`、以及「还没开分」的 `0` /
 * 缺失。后两种在 UI 上都是「不显示」，所以统一返回空字符串。
 */
export function normalizeDoubanRate(value: unknown): string {
  let num: number;

  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    num = Number(trimmed);
  } else {
    return '';
  }

  if (!Number.isFinite(num) || num <= 0 || num > 10) return '';
  return num.toFixed(1);
}

/**
 * 从豆瓣 subject 详情响应里取评分。
 *
 * rexxar `/v2/subject/{id}` 返回 `{ rating: { value, count, max } }`；
 * 未开分时 `rating` 为 null 或 `value` 为 0 —— 两者都归一成空字符串。
 */
export function extractDoubanSubjectRate(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const rating = (payload as { rating?: unknown }).rating;
  if (!rating || typeof rating !== 'object') return '';
  return normalizeDoubanRate((rating as { value?: unknown }).value);
}

/** 判断一个 id 是否是合法的豆瓣 subject id（纯数字字符串）。 */
export function isDoubanSubjectId(value: unknown): value is string {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0;
  }
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && /^\d+$/.test(trimmed);
}

/**
 * 清洗外部传入的 id 列表（路由参数 / 调用方透传）。
 *
 * 去重、去空、只留数字 id，并截断到 limit。
 */
export function normalizeRateLookupIds(
  input: unknown,
  limit: number = RATE_LOOKUP_LIMIT
): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of input) {
    if (!isDoubanSubjectId(raw)) continue;
    const id = typeof raw === 'number' ? String(raw) : raw.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * 收集「有 douban_id 但还没有评分」的条目 id。
 *
 * 已经有评分的条目不重复查（豆瓣列表自带评分，不必再打一次详情）。
 */
export function collectRateLookupIds(
  items: RateLookupCandidate[] | null | undefined,
  limit: number = RATE_LOOKUP_LIMIT
): string[] {
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.rate) continue; // 已有评分，跳过
    if (!isDoubanSubjectId(item.id)) continue;
    const id = String(item.id).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * 把 `id -> rate` 映射合并回条目列表。
 *
 * 只填 `rate`，其它字段原样保留；没有任何变化（或压根没查到）时返回**原数组
 * 引用**，方便调用方用引用相等判断是否需要 setState。
 */
export function mergeDoubanRates<T extends { id: string; rate: string }>(
  items: T[],
  rates: Record<string, string> | null | undefined
): T[] {
  if (!Array.isArray(items) || !rates) return items;

  let changed = false;
  const next = items.map((item) => {
    if (item.rate) return item;
    const rate = normalizeDoubanRate(rates[item.id]);
    if (!rate) return item;
    changed = true;
    return { ...item, rate };
  });

  return changed ? next : items;
}
