import type { PlayRecord } from '../types';
import {
  buildWatchStats,
  ESTIMATED_MINUTES,
  estimatedMinutes,
  formatEstimatedDuration,
  normalizeWatchInput,
  watchedEpisodes,
} from '../watch-stats';

function makeRecord(over: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '测试影片',
    source_name: '测试源',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 1,
    play_time: 0,
    total_time: 0,
    save_time: Date.UTC(2026, 0, 2),
    search_title: '',
    ...over,
  };
}

describe('watchedEpisodes', () => {
  test('电影（总集数 <= 1）按 1 集算', () => {
    expect(watchedEpisodes(makeRecord({ total_episodes: 1, index: 1 }))).toBe(1);
    expect(watchedEpisodes(makeRecord({ total_episodes: 0, index: 1 }))).toBe(1);
  });

  test('剧集按 index 算，且夹在总集数内', () => {
    expect(watchedEpisodes(makeRecord({ index: 5, total_episodes: 12 }))).toBe(5);
    // 数据异常：index 超过总集数时不该把总集数+1 算进去
    expect(watchedEpisodes(makeRecord({ index: 20, total_episodes: 12 }))).toBe(12);
  });

  test('没看过的返回 0', () => {
    expect(watchedEpisodes(makeRecord({ index: 0, total_episodes: 12 }))).toBe(0);
  });
});

describe('estimatedMinutes', () => {
  test('电影按 100 分钟', () => {
    expect(estimatedMinutes(makeRecord({ total_episodes: 1, index: 1 }))).toBe(
      ESTIMATED_MINUTES.movie
    );
  });

  test('剧集按集数 × 45 分钟', () => {
    expect(estimatedMinutes(makeRecord({ index: 10, total_episodes: 20 }))).toBe(450);
  });

  test('没点开的电影不计时长', () => {
    expect(estimatedMinutes(makeRecord({ total_episodes: 1, index: 0 }))).toBe(0);
  });
});

describe('normalizeWatchInput', () => {
  test('过滤掉缺标题 / 数值字段的脏记录', () => {
    const input = normalizeWatchInput({
      ok: makeRecord(),
      noTitle: makeRecord({ title: '   ' }),
      badNumber: makeRecord({ index: NaN, total_episodes: NaN }),
    });
    expect(input.map((i) => i.key)).toEqual(['ok']);
  });

  test('空输入不炸', () => {
    expect(normalizeWatchInput(null)).toEqual([]);
    expect(normalizeWatchInput(undefined)).toEqual([]);
    expect(normalizeWatchInput({} as any)).toEqual([]);
  });
});

describe('buildWatchStats', () => {
  const records = {
    'a+movie': makeRecord({
      title: '电影A',
      source_name: '源甲',
      total_episodes: 1,
      index: 1,
      save_time: Date.UTC(2026, 0, 2),
    }),
    'b+ep': makeRecord({
      title: '剧集B',
      source_name: '源甲',
      total_episodes: 12,
      index: 8,
      save_time: Date.UTC(2025, 5, 8),
    }),
    'c+ep': makeRecord({
      title: '剧集C',
      source_name: '源乙',
      total_episodes: 10,
      index: 10,
      save_time: Date.UTC(2026, 3, 9),
    }),
  };

  test('总览数字正确', () => {
    const stats = buildWatchStats(records);
    expect(stats.totalTitles).toBe(3);
    // 电影 1 + 剧集 8 + 剧集 10 = 19
    expect(stats.totalEpisodes).toBe(19);
    expect(stats.finishedTitles).toBe(1); // 剧集C 看完
    expect(stats.watchingTitles).toBe(1); // 剧集B 在追
  });

  test('时长为估算值（100 + 8*45 + 10*45）', () => {
    const stats = buildWatchStats(records);
    expect(stats.estimatedMinutes).toBe(100 + 360 + 450);
  });

  test('按来源聚合且按数量倒序', () => {
    const stats = buildWatchStats(records);
    expect(stats.bySource[0]).toEqual({ name: '源甲', count: 2, episodes: 9 });
    expect(stats.bySource[1].name).toBe('源乙');
  });

  test('按年份倒序', () => {
    const stats = buildWatchStats(records);
    expect(stats.byYear.map((y) => y.year)).toEqual([2026, 2025]);
    expect(stats.byYear[0].count).toBe(2);
  });

  test('Top 榜单按集数倒序', () => {
    const stats = buildWatchStats(records);
    expect(stats.topByEpisodes.map((t) => t.title)).toEqual([
      '剧集C',
      '剧集B',
      '电影A',
    ]);
  });

  test('最近在追按保存时间倒序', () => {
    const stats = buildWatchStats(records);
    expect(stats.topRecent[0].title).toBe('剧集C');
    expect(stats.topRecent[0].saveTime).toBeGreaterThan(stats.topRecent[1].saveTime);
  });

  test('Top 数量可限制', () => {
    const stats = buildWatchStats(records, 1);
    expect(stats.topByEpisodes).toHaveLength(1);
    expect(stats.topRecent).toHaveLength(1);
  });

  test('空记录不炸且各字段为零', () => {
    const stats = buildWatchStats({});
    expect(stats.totalTitles).toBe(0);
    expect(stats.totalEpisodes).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
    expect(stats.bySource).toEqual([]);
    expect(stats.topByEpisodes).toEqual([]);
  });
});

describe('formatEstimatedDuration', () => {
  test('小时与分钟的组合文案', () => {
    expect(formatEstimatedDuration(0)).toBe('0 分钟');
    expect(formatEstimatedDuration(45)).toBe('45 分钟');
    expect(formatEstimatedDuration(60)).toBe('1 小时');
    expect(formatEstimatedDuration(90)).toBe('1 小时 30 分');
    expect(formatEstimatedDuration(750)).toBe('12 小时 30 分');
  });

  test('非法输入不炸', () => {
    expect(formatEstimatedDuration(NaN)).toBe('0 分钟');
    expect(formatEstimatedDuration(-10)).toBe('0 分钟');
  });
});
