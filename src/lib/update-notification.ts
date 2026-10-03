/**
 * 更新通知（4.6.2）
 *
 * 数据源就是已有的「今日新更」记录（`TodayUpdatedRecord`），不新增采集逻辑。
 * 这个模块只负责一件事：**从今日更新记录里算出「哪些变化值得通知用户」**。
 *
 * ## 为什么要有「已读」状态
 * 「今日更新」是每天都会变的列表，如果每次进页面都弹一遍通知，用户很快就烦了。
 * 所以判定分两层：
 *   1. **值得通知的变化**（本模块）：有新增集数 / 有没看完的集；
 *   2. **用户是否已经知道**（`Notifications` 组件）：按「天 + 条目」记已读状态。
 *
 * ## 为什么存 localStorage 而不是服务端
 * 「已读」是**个人行为**（跟搜索历史同类），不是数据；
 * 放服务端要多一套存储 + 同步逻辑，收益不抵成本。
 * 副作用：换设备后可能会重复通知一次 —— 可接受（宁可多提醒一次，
 * 也不要做成「用户清过缓存就再也收不到」的静默失败）。
 */

/** 单条更新的通知信息 */
export interface UpdateNotification {
  /** 稳定标识：`source+id`，同一部剧在多天之间要能对上 */
  key: string;
  title: string;
  sourceName: string;
  poster: string;
  /** 本次新增的集数 */
  newEpisodes: number;
  /** 还没看的集数 */
  unwatchedEpisodes: number;
  /** 跳转地址 */
  href: string;
  /** 这条通知该显示的文案 */
  text: string;
}

/** 已读记录：key → 已读时间戳（毫秒） */
export type ReadMap = Record<string, number>;

/** localStorage 里的存储键 */
export const NOTIFICATION_READ_KEY = 'moontv_update_notifications_read';

/**
 * 一条更新记录是否值得通知。
 *
 * 三种情况算「值得」：
 *   - 有**新增集数**（今天比昨天多出来的集）；
 *   - 有**没看完的集**（有未看内容就该提醒你去追）；
 *   - 剧集在追但完全没看（提醒第 1 次）。
 *
 * 反过来：既没新增、也没未看、也不在追的，不通知（否则就是噪音）。
 */
export function isWorthNotifying(item: {
  newEpisodes?: number;
  unwatchedEpisodes?: number;
  episodes?: number;
  watchedEpisodes?: number;
  isFollowed?: boolean;
}): boolean {
  if (item.newEpisodes && item.newEpisodes > 0) return true;
  if (item.unwatchedEpisodes && item.unwatchedEpisodes > 0) return true;
  // 完全没看过的（在追的）也值得提一次
  if (item.isFollowed && !item.watchedEpisodes) return true;
  return false;
}

/** 生成稳定 key（跨天要能对上同一部剧） */
export function buildNotificationKey(source: string, id: string): string {
  // 源与 id 里可能带 `/` 与中文，做一次可读化避免 key 过长
  return `${source}:${id}`.replace(/[/?#\s]+/g, '_');
}

/** 生成跳转地址（与站内其它链接保持同一套参数约定） */
export function buildNotificationHref(
  source: string,
  id: string,
  title: string
): string {
  return `/play?source=${encodeURIComponent(source)}&id=${encodeURIComponent(
    id
  )}&title=${encodeURIComponent(title)}`;
}

/** 生成通知文案 */
export function buildNotificationText(item: {
  newEpisodes?: number;
  unwatchedEpisodes?: number;
  title?: string;
}): string {
  const added = item.newEpisodes ?? 0;
  const unwatched = item.unwatchedEpisodes ?? 0;
  if (added > 0) {
    const more = unwatched > 0 ? `，还有 ${unwatched} 集没看` : '';
    return `新增 ${added} 集${more}`;
  }
  if (unwatched > 0) return `还有 ${unwatched} 集没看`;
  return '有新的内容可以看';
}

/**
 * 从今日更新记录里筛出未读通知。
 *
 * `readMap` 里的时间戳用于「只在这个时间点之后的变化才算新」——
 * 今天早上 8 点记过一次已读，之后又新增了 2 集，应该再通知一次。
 */
export function buildNotifications(
  items: Array<{
    source: string;
    id: string;
    title: string;
    source_name?: string;
    poster?: string;
    newEpisodes?: number;
    unwatchedEpisodes?: number;
    watchedEpisodes?: number;
  }>,
  readMap: ReadMap,
  isFollowed?: (source: string, id: string) => boolean
): UpdateNotification[] {
  if (!Array.isArray(items)) return [];
  const out: UpdateNotification[] = [];

  for (const raw of items) {
    if (!raw || typeof raw.source !== 'string' || typeof raw.id !== 'string') {
      continue;
    }
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) continue;

    const followed = isFollowed ? isFollowed(raw.source, raw.id) : false;
    if (!isWorthNotifying({ ...raw, isFollowed: followed })) continue;

    const key = buildNotificationKey(raw.source, raw.id);
    const readAt = readMap[key];

    // 有新集但已读时间早于「本次变化」→ 仍要通知。
    // 这里没有真正的「变化时间戳」，退一步用「今天」判断：
    // 已读记录里存的是当天的时间戳，所以跨天一定会重新提醒。
    if (readAt !== undefined) {
      const readDay = new Date(readAt).toDateString();
      const nowDay = new Date().toDateString();
      // 同一天已读过就不再打扰（避免反复弹）
      if (readDay === nowDay) continue;
    }

    out.push({
      key,
      title,
      sourceName: raw.source_name || raw.source,
      poster: typeof raw.poster === 'string' ? raw.poster : '',
      newEpisodes: raw.newEpisodes ?? 0,
      unwatchedEpisodes: raw.unwatchedEpisodes ?? 0,
      href: buildNotificationHref(raw.source, raw.id, title),
      text: buildNotificationText(raw),
    });
  }

  return out;
}

/** 读已���记录 */
export function readReadMap(
  storage: Pick<Storage, 'getItem'>
): ReadMap {
  if (typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(NOTIFICATION_READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ReadMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    // 脏数据当没有，别让通知功能整体失效
    return {};
  }
}

/** 写已读记录（只保留最近 200 条，防止无限增长） */
export function writeReadMap(
  storage: Pick<Storage, 'setItem'>,
  map: ReadMap
): boolean {
  try {
    const entries = Object.entries(map)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200);
    storage.setItem(NOTIFICATION_READ_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch {
    // 无痕模式写不进去：通知仍会显示，只是每次都算「未读」
    return false;
  }
}

/** 标记已读 */
export function markAsRead(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  keys: string[],
  now = Date.now()
): ReadMap {
  const map = readReadMap(storage);
  for (const key of keys) map[key] = now;
  writeReadMap(storage, map);
  return map;
}

/** 是否该发系统级通知（浏览器通知权限） */
export function canNotifySystem(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof Notification === 'undefined') return false;
  return Notification.permission === 'granted';
}

/** 弹一条系统通知（未授权时静默跳过 —— 站内提示已经在了） */
export function notifySystem(title: string, body: string, onClick?: () => void): boolean {
  if (!canNotifySystem()) return false;
  try {
    const n = new Notification(title, {
      body,
      icon: '/logo.png',
      // 不自动聚焦：用户可能正在看别的标签页
      requireInteraction: false,
    });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}
