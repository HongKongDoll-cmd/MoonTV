/**
 * 观影统计（纯计算）。
 *
 * 数据源就是播放记录（`getAllPlayRecords`），所以统计**全部在客户端算**，
 * 不需要新接口，服务端也不用改。
 *
 * ## 关于时长
 *
 * `play_time` 是「上次播到第几秒」（进度），不是累计观看时长，
 * 拿它当观影时长得出的数字是假的。所以这里的时长是**估算**：
 * 电影按 100 分钟、剧集按每集 45 分钟乘以已看集数，并在 UI 上明确写「约」。
 * 真要精确累计，得在播放引擎里另记「本次会话实际播放秒数」并累加。
 */

import type { PlayRecord } from './types';

/** 统计口径：估算单集时长（分钟） */
export const ESTIMATED_MINUTES = {
  movie: 100,
  episode: 45,
} as const;

export interface WatchStatInput {
  /** 记录 key（`source+id`） */
  key: string;
  /** 记录里的源名，key 里没有时用它兜底 */
  sourceName: string;
  record: PlayRecord;
}

export interface WatchStats {
  /** 看过的不同条目数 */
  totalTitles: number;
  /** 累计观看集数（电影按 1 集算） */
  totalEpisodes: number;
  /** 估算总时长（分钟） */
  estimatedMinutes: number;
  /** 看完的条目数（index >= total_episodes） */
  finishedTitles: number;
  /** 在追的条目数（看了一半以上） */
  watchingTitles: number;
  /** 按源统计 */
  bySource: Array<{ name: string; count: number; episodes: number }>;
  /** 按年份统计（按记录保存时间） */
  byYear: Array<{ year: number; count: number; episodes: number }>;
  /** 看集数最多的条目 */
  topByEpisodes: Array<{
    key: string;
    title: string;
    sourceName: string;
    cover: string;
    index: number;
    totalEpisodes: number;
  }>;
  /** 最近在追的条目（按保存时间倒序） */
  topRecent: Array<{
    key: string;
    title: string;
    sourceName: string;
    cover: string;
    index: number;
    totalEpisodes: number;
    saveTime: number;
  }>;
}

/** 判断这条记录算电影还是剧集 */
function isMovieRecord(record: PlayRecord): boolean {
  return (record.total_episodes ?? 0) <= 1;
}

/** 已看集数：电影记 1，剧集按 index（并夹到总集数内） */
export function watchedEpisodes(record: PlayRecord): number {
  if (isMovieRecord(record)) return 1;
  const index = Number(record.index) || 0;
  const total = Number(record.total_episodes) || 0;
  if (index <= 0) return 0;
  return total > 0 ? Math.min(index, total) : index;
}

/** 估算观看分钟数 */
export function estimatedMinutes(record: PlayRecord): number {
  if (isMovieRecord(record)) {
    // 只点开没看完也按 0 记更诚实，但多数电影记录 index=1
    return Number(record.index) > 0 ? ESTIMATED_MINUTES.movie : 0;
  }
  return watchedEpisodes(record) * ESTIMATED_MINUTES.episode;
}

/** 把 `Record<key, PlayRecord>` 转成带 key / 源名的数组，并滤掉脏数据 */
export function normalizeWatchInput(
  records: Record<string, PlayRecord> | null | undefined
): WatchStatInput[] {
  if (!records || typeof records !== 'object') return [];
  return Object.entries(records)
    .filter(([key, record]) => {
      if (!key || !record) return false;
      if (typeof record.title !== 'string' || !record.title.trim()) return false;
      return Number.isFinite(Number(record.index)) || Number.isFinite(Number(record.total_episodes));
    })
    .map(([key, record]) => ({
      key,
      sourceName: record.source_name?.trim() || '未知来源',
      record,
    }));
}

export function buildWatchStats(
  records: Record<string, PlayRecord> | null | undefined,
  topLimit = 10
): WatchStats {
  const items = normalizeWatchInput(records);

  let totalEpisodes = 0;
  let estimated = 0;
  let finishedTitles = 0;
  let watchingTitles = 0;

  const sourceMap = new Map<string, { count: number; episodes: number }>();
  const yearMap = new Map<number, { count: number; episodes: number }>();

  for (const item of items) {
    const { record } = item;
    const episodes = watchedEpisodes(record);
    const minutes = estimatedMinutes(record);
    totalEpisodes += episodes;
    estimated += minutes;

    const total = Number(record.total_episodes) || 0;
    const index = Number(record.index) || 0;
    if (total > 1 && index >= total) finishedTitles += 1;
    if (total > 1 && index > 0 && index < total) watchingTitles += 1;

    const source = sourceMap.get(item.sourceName) ?? { count: 0, episodes: 0 };
    source.count += 1;
    source.episodes += episodes;
    sourceMap.set(item.sourceName, source);

    const year =
      Number(record.save_time) > 0 ? new Date(record.save_time).getFullYear() : 0;
    if (year > 1970) {
      const bucket = yearMap.get(year) ?? { count: 0, episodes: 0 };
      bucket.count += 1;
      bucket.episodes += episodes;
      yearMap.set(year, bucket);
    }
  }

  const toEntry = (key: string) => {
    const record = items.find((item) => item.key === key)?.record;
    return {
      key,
      title: record?.title ?? '',
      sourceName: items.find((item) => item.key === key)?.sourceName ?? '',
      cover: record?.cover ?? '',
      index: Number(record?.index) || 0,
      totalEpisodes: Number(record?.total_episodes) || 0,
    };
  };

  const topByEpisodes = [...items]
    .sort((a, b) => watchedEpisodes(b.record) - watchedEpisodes(a.record))
    .slice(0, topLimit)
    .map((item) => toEntry(item.key));

  const topRecent = [...items]
    .sort((a, b) => (b.record.save_time || 0) - (a.record.save_time || 0))
    .slice(0, topLimit)
    .map((item) => ({
      ...toEntry(item.key),
      saveTime: Number(item.record.save_time) || 0,
    }));

  return {
    totalTitles: items.length,
    totalEpisodes,
    estimatedMinutes: estimated,
    finishedTitles,
    watchingTitles,
    // 用 Array.from 包一层：tsconfig target 低于 es2015 时 for...of 不能迭代 Map
    bySource: Array.from(sourceMap.entries())
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.count - a.count),
    byYear: Array.from(yearMap.entries())
      .map(([year, value]) => ({ year, ...value }))
      .sort((a, b) => b.year - a.year),
    topByEpisodes,
    topRecent,
  };
}

/** 分钟数 → 「约 12 小时 30 分」 */
export function formatEstimatedDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} 分钟`;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}
