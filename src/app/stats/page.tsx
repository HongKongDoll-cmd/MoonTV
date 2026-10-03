'use client';

import { BarChart3, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { getAllPlayRecords } from '@/lib/db.client';
import { applyImageFallback } from '@/lib/douban-image';
import type { PlayRecord } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';
import {
  type WatchStats,
  buildWatchStats,
  formatEstimatedDuration,
} from '@/lib/watch-stats';

import PageLayout from '@/components/PageLayout';

/**
 * 观影统计（4.5.8）。
 *
 * 数据全部来自播放记录，**在客户端算**，所以没有新接口、服务端零改动。
 * 时长是估算值（电影 100 分钟 / 剧集每集 45 分钟 × 已看集数），
 * 页面上明确写「约」——播放记录里的 `play_time` 是进度不是累计时长，
 * 拿它当观看时长是假的。
 */
export default function StatsPage() {
  const [records, setRecords] = useState<Record<string, PlayRecord> | null>(
    null
  );

  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAllPlayRecords()
      .then((data) => {
        // getAllPlayRecords 返回的是以 key 为索引的对象；空数据统一成 {}
        if (!cancelled) setRecords(data as Record<string, PlayRecord>);
      })
      .catch(() => {
        if (!cancelled) setLoadError('读取播放记录失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats: WatchStats | null = useMemo(
    () => (records ? buildWatchStats(records) : null),
    [records]
  );

  return (
    <PageLayout>
      <div className='moontv-sidenav-content min-h-screen px-4 py-6 sm:px-8 md:pl-[calc(var(--moontv-sidenav-w)+2.5rem)] md:pr-8'>
        <h1 className='mb-1 flex items-center gap-2 text-2xl font-bold text-gray-800 dark:text-gray-200'>
          <BarChart3 className='h-6 w-6' />
          观影统计
        </h1>
        <p className='mb-6 text-sm text-gray-500 dark:text-gray-400'>
          时长为估算值（电影按 100 分钟、剧集按每集 45 分钟计），仅供参考。
        </p>

        {loadError && (
          <p className='text-sm text-red-500'>{loadError}</p>
        )}

        {!stats && !loadError && (
          <p className='text-sm text-gray-500 dark:text-gray-400'>加载中…</p>
        )}

        {stats && stats.totalTitles === 0 && (
          <div className='rounded-xl border border-gray-200/70 p-8 text-center dark:border-gray-700/60'>
            <p className='mb-2 text-gray-600 dark:text-gray-300'>还没有播放记录</p>
            <Link
              href='/'
              className='text-sm text-green-600 hover:underline dark:text-green-400'
            >
              去看点什么 →
            </Link>
          </div>
        )}

        {stats && stats.totalTitles > 0 && (
          <div className='flex flex-col gap-6'>
            {/* 总览卡片 */}
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
              <StatTile label='看过' value={String(stats.totalTitles)} unit='部' />
              <StatTile label='累计集数' value={String(stats.totalEpisodes)} unit='集' />
              <StatTile
                label='估算时长'
                value={formatEstimatedDuration(stats.estimatedMinutes)}
                unit=''
              />
              <StatTile label='看完' value={String(stats.finishedTitles)} unit='部' />
              <StatTile label='在追' value={String(stats.watchingTitles)} unit='部' />
              <StatTile
                label='来源'
                value={String(stats.bySource.length)}
                unit='个'
              />
            </div>

            {/* 年度分布 */}
            {stats.byYear.length > 0 && (
              <section className='rounded-xl border border-gray-200/70 p-4 dark:border-gray-700/60'>
                <h2 className='mb-3 text-base font-medium text-gray-800 dark:text-gray-200'>
                  每年看过
                </h2>
                <div className='flex flex-col gap-2'>
                  {stats.byYear.map((row) => {
                    const max = Math.max(...stats.byYear.map((y) => y.count), 1);
                    return (
                      <div key={row.year} className='flex items-center gap-3'>
                        <span className='w-14 flex-shrink-0 text-sm text-gray-600 dark:text-gray-300'>
                          {row.year}
                        </span>
                        <div className='h-5 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-white/10'>
                          <div
                            className='flex h-full items-center justify-end rounded bg-green-500/80 pr-1.5 text-[11px] font-medium text-white'
                            style={{ width: `${(row.count / max) * 100}%` }}
                          >
                            {row.count} 部 · {row.episodes} 集
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 来源分布 */}
            {stats.bySource.length > 0 && (
              <section className='rounded-xl border border-gray-200/70 p-4 dark:border-gray-700/60'>
                <h2 className='mb-3 text-base font-medium text-gray-800 dark:text-gray-200'>
                  来源分布
                </h2>
                <div className='flex flex-wrap gap-2'>
                  {stats.bySource.map((row) => (
                    <span
                      key={row.name}
                      className='rounded-full border border-gray-300/70 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300'
                    >
                      {row.name}
                      <span className='ml-1.5 text-xs text-gray-500 dark:text-gray-400'>
                        {row.count} 部 / {row.episodes} 集
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Top 榜 */}
            <StatList
              title='看得最多'
              icon={<Trophy className='h-4 w-4' />}
              items={stats.topByEpisodes.map((item) => ({
                key: item.key,
                title: item.title,
                sourceName: item.sourceName,
                cover: item.cover,
                meta: `看到第 ${item.index} 集${
                  item.totalEpisodes > 1 ? ` / 共 ${item.totalEpisodes} 集` : ''
                }`,
              }))}
            />

            {/* 最近在追 */}
            <StatList
              title='最近在看'
              items={stats.topRecent.map((item) => ({
                key: item.key,
                title: item.title,
                sourceName: item.sourceName,
                cover: item.cover,
                meta: `看到第 ${item.index} 集${
                  item.totalEpisodes > 1 ? ` / 共 ${item.totalEpisodes} 集` : ''
                }`,
              }))}
            />
          </div>
        )}
      </div>
    </PageLayout>
  );
}

function StatTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className='rounded-xl border border-gray-200/70 p-3 text-center dark:border-gray-700/60'>
      <div className='text-xs text-gray-500 dark:text-gray-400'>{label}</div>
      <div className='mt-1 text-lg font-semibold text-gray-800 dark:text-gray-100'>
        {value}
        {unit && <span className='ml-0.5 text-xs font-normal text-gray-500'>{unit}</span>}
      </div>
    </div>
  );
}

function StatList({
  title,
  icon,
  items,
}: {
  title: string;
  icon?: React.ReactNode;
  items: Array<{
    key: string;
    title: string;
    sourceName: string;
    cover: string;
    meta: string;
  }>;
}) {
  if (items.length === 0) return null;
  return (
    <section className='rounded-xl border border-gray-200/70 p-4 dark:border-gray-700/60'>
      <h2 className='mb-3 flex items-center gap-1.5 text-base font-medium text-gray-800 dark:text-gray-200'>
        {icon}
        {title}
      </h2>
      <ul className='flex flex-col gap-2'>
        {items.map((item) => (
          <li key={item.key} className='flex items-center gap-3'>
            <div className='relative h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-gray-200 dark:bg-gray-700'>
              {item.cover && (
                <img
                  src={processImageUrl(item.cover)}
                  alt={item.title}
                  className='h-full w-full object-cover'
                  onError={(e) =>
                    applyImageFallback(
                      e.target as HTMLImageElement,
                      item.cover,
                      processImageUrl(item.cover)
                    )
                  }
                />
              )}
            </div>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm text-gray-800 dark:text-gray-100'>
                {item.title}
              </div>
              <div className='truncate text-xs text-gray-500 dark:text-gray-400'>
                {item.sourceName} · {item.meta}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
