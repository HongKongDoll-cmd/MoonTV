'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Grid2x2,
  Grid3x3,
  LayoutGrid,
  List,
  RefreshCw,
} from 'lucide-react';

import type { LibrarySort } from '@/lib/library-sort';
import {
  LIBRARY_SORT_FIELD_LABELS,
  LIBRARY_SORT_FIELDS,
} from '@/lib/library-sort';
import type { LibraryView } from '@/lib/library-view';
import { LIBRARY_VIEWS } from '@/lib/library-view';

/**
 * 影库右侧内容区的顶部工具栏：面包屑 + 查看方式 + 排序 + 刷新。
 *
 * 「查看方式」照 Windows 资源管理器「右键 → 查看」的四档：
 * 列表 / 小图标 / 中等图标 / 大图标。排序则是「名称 / 大小 / 时间」三选一
 * 外加升降序切换。两者的选择都存 localStorage，刷新后保持。
 */
export interface LibraryToolbarProps {
  segments: string[];
  canUp: boolean;
  onUp: () => void;
  onRoot: () => void;
  onSegment: (index: number) => void;
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  onRefresh: () => void;
  /** 当前目录条目数，显示在右侧 */
  count: number;
}

const VIEW_META: Record<LibraryView, { icon: LucideIcon; label: string }> = {
  list: { icon: List, label: '列表' },
  small: { icon: Grid2x2, label: '小图标' },
  medium: { icon: Grid3x3, label: '中等图标' },
  large: { icon: LayoutGrid, label: '大图标' },
};

const LibraryToolbar = ({
  segments,
  canUp,
  onUp,
  onRoot,
  onSegment,
  view,
  onViewChange,
  sort,
  onSortChange,
  onRefresh,
  count,
}: LibraryToolbarProps) => (
  <div className='mb-3 flex flex-wrap items-center gap-1 text-sm text-gray-500 dark:text-gray-400'>
    <button
      type='button'
      onClick={onUp}
      disabled={!canUp}
      className='flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800'
      title='上一级'
    >
      <ArrowLeft className='h-4 w-4' />
      上级
    </button>
    <button
      type='button'
      onClick={onRoot}
      className='rounded-lg px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
      title='影库根目录'
    >
      根目录
    </button>
    {segments.map((segment, index) => (
      <span key={`${segment}-${index}`} className='flex min-w-0 items-center'>
        <span className='px-1 text-gray-300 dark:text-gray-600'>/</span>
        <button
          type='button'
          onClick={() => onSegment(index)}
          className='max-w-32 truncate rounded-lg px-2 py-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
        >
          {segment}
        </button>
      </span>
    ))}

    <div className='ml-auto flex items-center gap-1'>
      <span className='mr-1 text-xs text-gray-400 dark:text-gray-500'>
        {count} 项
      </span>
      {/* 排序：字段三选一 + 方向切换，两者都记进 localStorage */}
      <div
        className='flex items-center gap-0.5 rounded-lg border border-gray-200/70 p-0.5 dark:border-gray-700/60'
        data-testid='library-sort'
      >
        {LIBRARY_SORT_FIELDS.map((field) => {
          const active = sort.field === field;
          return (
            <button
              key={field}
              type='button'
              onClick={() => onSortChange({ field, order: sort.order })}
              aria-pressed={active}
              className={`rounded-md px-2 py-1 text-xs transition-colors ${
                active
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {LIBRARY_SORT_FIELD_LABELS[field]}
            </button>
          );
        })}
      </div>
      <button
        type='button'
        onClick={() =>
          onSortChange({
            field: sort.field,
            order: sort.order === 'asc' ? 'desc' : 'asc',
          })
        }
        aria-label={sort.order === 'asc' ? '切换为降序' : '切换为升序'}
        title={sort.order === 'asc' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
        className='flex items-center gap-1 rounded-lg border border-gray-200/70 px-2 py-1.5 text-xs transition-colors hover:bg-gray-100 dark:border-gray-700/60 dark:hover:bg-gray-800'
      >
        {sort.order === 'asc' ? (
          <ArrowUp className='h-3.5 w-3.5' />
        ) : (
          <ArrowDown className='h-3.5 w-3.5' />
        )}
        {sort.order === 'asc' ? '升序' : '降序'}
      </button>
      <div className='flex items-center gap-0.5 rounded-lg border border-gray-200/70 p-0.5 dark:border-gray-700/60'>
        {LIBRARY_VIEWS.map((candidate) => {
          const Icon = VIEW_META[candidate].icon;
          const active = view === candidate;
          return (
            <button
              key={candidate}
              type='button'
              onClick={() => onViewChange(candidate)}
              title={VIEW_META[candidate].label}
              aria-label={VIEW_META[candidate].label}
              aria-pressed={active}
              className={`rounded-md p-1.5 transition-colors ${
                active
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Icon className='h-4 w-4' />
            </button>
          );
        })}
      </div>
      <button
        type='button'
        onClick={onRefresh}
        className='flex items-center gap-1 rounded-lg border border-gray-200/70 px-2 py-1.5 text-xs transition-colors hover:bg-gray-100 dark:border-gray-700/60 dark:hover:bg-gray-800'
        title='重新读取当前目录'
      >
        <RefreshCw className='h-3.5 w-3.5' />
        刷新
      </button>
    </div>
  </div>
);

export default LibraryToolbar;
