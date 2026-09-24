/**
 * 影库列表排序（名称 / 大小 / 时间）。
 *
 * ## 为什么单独成模块
 *
 * 与 `library-view.ts`（查看方式）同构：纯偏好 + 纯比较逻辑，跟 OpenList 协议
 * 无关。放在这里可以单测，`OpenListBrowser` 只负责把选择传进来。
 *
 * ## 两条刻意保留的规则
 *
 * 1. **目录永远排在文件前面**（跟资源管理器一致）。影库里目录是「剧 / 季 / 网盘」，
 *    混进文件里按大小排会变得很难找；升降序只翻转组**内部**的顺序。
 * 2. **缺时间的条目恒排在最后**（不管升序降序）。OpenList 有些驱动不返回
 *    `modified`，把它们当成 0 会伪装成「1970 年的老片」，降序时直接沉底就对了。
 */

import { naturalCompare } from './openlist';

export const LIBRARY_SORT_KEY = 'moontv_library_sort';

export const LIBRARY_SORT_FIELDS = ['name', 'size', 'time'] as const;

export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number];

export type LibrarySortOrder = 'asc' | 'desc';

export interface LibrarySort {
  field: LibrarySortField;
  order: LibrarySortOrder;
}

/** 排序项的**最小**约束：`OpenListItem` 直接满足，测试里也能塞假数据 */
export interface LibrarySortableItem {
  name: string;
  is_dir: boolean;
  size?: number;
  modified?: string;
}

/** 默认：按名称升序（改造前的顺序，老用户无感） */
export const DEFAULT_LIBRARY_SORT: LibrarySort = {
  field: 'name',
  order: 'asc',
};

export const LIBRARY_SORT_FIELD_LABELS: Record<LibrarySortField, string> = {
  name: '名称',
  size: '大小',
  time: '时间',
};

export function isLibrarySortField(value: unknown): value is LibrarySortField {
  return (
    typeof value === 'string' &&
    (LIBRARY_SORT_FIELDS as readonly string[]).includes(value)
  );
}

export function isLibrarySortOrder(value: unknown): value is LibrarySortOrder {
  return value === 'asc' || value === 'desc';
}

/** 存储格式：`"<field>:<order>"`（比 JSON 省事，读回来也一眼能看懂） */
export function serializeLibrarySort(sort: LibrarySort): string {
  return `${sort.field}:${sort.order}`;
}

/** 解析存储值，不合法返回 null（交给调用方退回默认） */
export function parseLibrarySort(raw: unknown): LibrarySort | null {
  if (typeof raw !== 'string' || !raw) return null;
  const [field, order] = raw.split(':');
  if (!isLibrarySortField(field) || !isLibrarySortOrder(order)) return null;
  return { field, order };
}

export function normalizeLibrarySort(value: unknown): LibrarySort {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<LibrarySort>;
    if (
      isLibrarySortField(candidate.field) &&
      isLibrarySortOrder(candidate.order)
    ) {
      return { field: candidate.field, order: candidate.order };
    }
  }
  return parseLibrarySort(value) ?? DEFAULT_LIBRARY_SORT;
}

/** 读取上次选择的排序（localStorage 在隐私模式会抛错，读不到就默认） */
export function readLibrarySort(): LibrarySort {
  if (typeof window === 'undefined') return DEFAULT_LIBRARY_SORT;
  try {
    return normalizeLibrarySort(window.localStorage.getItem(LIBRARY_SORT_KEY));
  } catch {
    return DEFAULT_LIBRARY_SORT;
  }
}

export function writeLibrarySort(sort: LibrarySort): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LIBRARY_SORT_KEY, serializeLibrarySort(sort));
  } catch {
    // 存不下只影响下次进来的默认值
  }
}

/**
 * 解析 OpenList 的 `modified`。
 *
 * 形态是 ISO 字符串（`"2024-05-01T12:00:00+08:00"`）；有的驱动干脆不给。
 * 解析不出来返回 null——**不要退化成 0**，那是 1970 年，会把条目伪装成最旧的。
 */
export function parseModifiedTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? null : time;
}

/** 大小：目录一律按 0 算（OpenList 本来也不给目录大小） */
function sizeOf(item: LibrarySortableItem): number {
  return typeof item.size === 'number' && Number.isFinite(item.size)
    ? item.size
    : 0;
}

/**
 * 两个条目的先后。
 *
 * 返回值语义同 `Array.prototype.sort`：负数 = a 在前。
 */
export function compareLibraryItems(
  a: LibrarySortableItem,
  b: LibrarySortableItem,
  sort: LibrarySort = DEFAULT_LIBRARY_SORT
): number {
  // 1. 目录恒在前，不受升降序影响
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;

  const direction = sort.order === 'asc' ? 1 : -1;

  // 2. 名称：直接按自然序（S01E02 < S01E10 这种直觉）
  if (sort.field === 'name') {
    return direction * naturalCompare(a.name, b.name);
  }

  // 3. 大小：相等时用名称兜底（兜底不受方向影响，保证顺序稳定）
  if (sort.field === 'size') {
    const diff = sizeOf(a) - sizeOf(b);
    if (diff !== 0) return direction * diff;
    return naturalCompare(a.name, b.name);
  }

  // 4. 时间：缺时间恒排最后；都有时间时按先后，相等用名称兜底
  const at = parseModifiedTime(a.modified);
  const bt = parseModifiedTime(b.modified);
  if (at === null && bt === null) return naturalCompare(a.name, b.name);
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at === bt) return naturalCompare(a.name, b.name);
  return direction * (at - bt);
}

/** 排序（不改原数组，目录优先规则同上） */
export function sortLibraryItems<T extends LibrarySortableItem>(
  items: T[] | null | undefined,
  sort: LibrarySort = DEFAULT_LIBRARY_SORT
): T[] {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => compareLibraryItems(a, b, sort));
}
