/**
 * 换片识别（4.7.7）。
 *
 * 「换片」和「换集」是两件事：换集不该触发清理（那是另一个开关管的），
 * 换片才该把上一部影片的缓存收掉。判断依据是**影片标识**
 * （`${source}:${id}`，不含集数）。
 *
 * 为什么需要会话级存储而不是组件内 ref：从播放页跳到详情页再回来、
 * 或者整页刷新，组件会重新挂载，内存状态全丢。若只看 ref，
 * 重挂载后会被当成「首次进入」，于是永远判不出换片。
 * sessionStorage 跟着标签页走，正好符合「同一次浏览会话」的语义。
 */

/** sessionStorage 里记录「上一次看的影片」的键 */
export const VIDEO_TRACK_SESSION_KEY = 'moontv_last_video_key';

export interface VideoSwitchResult {
  /** 是否换到了**另一部**影片 */
  changed: boolean;
  /** 上一次的影片标识；没有记录时为 null */
  previous: string | null;
  /** 本次的影片标识（入参原样返回，便于调用方直接用） */
  current: string;
}

/** 取会话存储；拿不到（SSR / 隐私模式）时返回 null */
function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * 记录当前影片并判断是否发生了换片。
 *
 * 会在判断后**立即写入**当前影片标识，所以同一部片子反复调用只会
 * 在第一次返回 `changed: true`。
 *
 * @param currentVideoKey 当前影片标识（`${source}:${id}`）
 * @param storage 便于单测注入；默认用 window.sessionStorage
 */
export function trackVideoSwitch(
  currentVideoKey: string,
  storage: Storage | null = getSessionStorage()
): VideoSwitchResult {
  const current = typeof currentVideoKey === 'string' ? currentVideoKey : '';
  // 标识为空说明详情还没加载出来，这时候不该动记录，
  // 否则「还没认出来是谁」会被记成一次换片
  if (!current) return { changed: false, previous: null, current };

  if (!storage) return { changed: false, previous: null, current };

  let previous: string | null = null;
  try {
    previous = storage.getItem(VIDEO_TRACK_SESSION_KEY);
  } catch {
    previous = null;
  }

  try {
    storage.setItem(VIDEO_TRACK_SESSION_KEY, current);
  } catch {
    // 写不进去（配额/隐私模式）→ 退化成「每次都当首次」，只影响清理不触发
  }

  if (!previous) return { changed: false, previous: null, current };
  return { changed: previous !== current, previous, current };
}

/** 清掉会话记录（登出、切换用户时用） */
export function resetVideoTrack(
  storage: Storage | null = getSessionStorage()
): void {
  if (!storage) return;
  try {
    storage.removeItem(VIDEO_TRACK_SESSION_KEY);
  } catch {
    // ignore
  }
}

/** 一部影片的所有集数标识 → 影片标识 */
export function videoKeyOfEpisode(
  source: string,
  id: string
): string {
  return `${source}:${id}`;
}
