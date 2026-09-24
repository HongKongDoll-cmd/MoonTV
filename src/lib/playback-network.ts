/**
 * 播放链路诊断：判断当前这路视频是「直连网盘」还是「经影库服务器中转」，
 * 并把浏览器原生的缓冲状态翻译成人话。
 *
 * 为什么要这个模块：网盘视频是单文件（mkv/mp4），**不走 hls.js**，
 * 因此项目里给 HLS 做的那套（预写 Cache Storage、120s 前向缓冲、ABR 自动降档、
 * PlaybackRecovery）全部不生效，播放慢的时候用户完全不知道卡在哪。
 * 这里把「链路类型 + 缓冲水位 + 补缓冲速度 + 卡顿次数」摆到明面上，
 * 让用户能自己判断是服务器中转的锅、还是本地带宽的锅。
 *
 * 关于补缓冲速度（refillRate）：视频元素拿不到字节数（跨域直链也测不了速），
 * 所以用「每秒能补回多少秒的内容」这个倍率 —— 1× 是刚好跟得上播放，
 * 小于 1× 就是在吃老本，迟早转圈。这个指标不需要任何额外网络请求。
 */

/** 链路类型：直连网盘 / 经影库服务器中转 / 判不出来 */
export type PlaybackLinkKind = 'direct' | 'relay' | 'unknown';

/** 缓冲健康度（unknown = 还没采到样） */
export type BufferHealth = 'good' | 'tight' | 'starving' | 'unknown';

export const PLAYBACK_LINK_LABELS: Record<PlaybackLinkKind, string> = {
  direct: '网盘直连',
  relay: '经影库服务器中转',
  unknown: '链路未知',
};

export const BUFFER_HEALTH_LABELS: Record<BufferHealth, string> = {
  good: '缓冲充足',
  tight: '缓冲偏紧',
  starving: '缓冲不足',
  unknown: '测量中',
};

/**
 * 判定播放地址走的是哪条链路。
 *
 * - 与影库地址同源 → 中转（数据过影库服务器）
 * - OpenList 中转下载路径 `/d/<path>?sign=...` → 中转
 * - Emby / Jellyfin 的 `/Videos/<id>/stream` → 中转（一定过媒体服务器）
 * - 其它（网盘给的 raw_url，域名是网盘的）→ 直连
 */
export function classifyPlaybackLink(
  url: string | null | undefined,
  libraryHost?: string | null
): PlaybackLinkKind {
  const raw = String(url ?? '').trim();
  if (!raw) return 'unknown';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'unknown';
  }

  const host = parseHost(libraryHost);
  if (host && host === parsed.host) return 'relay';
  if (/\/d\//.test(parsed.pathname) && parsed.searchParams.has('sign')) {
    return 'relay';
  }
  if (/\/Videos\/[^/]+\/stream/.test(parsed.pathname)) return 'relay';
  return 'direct';
}

function parseHost(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

/** 缓冲水位（还能播多少秒），不足 1 秒按 0 计 */
export function formatBufferAhead(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes} 分 ${String(rest).padStart(2, '0')} 秒`;
}

/** 补缓冲倍率：1.0× 表示刚好跟得上播放 */
export function formatRefillRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${rate.toFixed(1)}×`;
}

/**
 * 综合缓冲水位与补缓冲倍率给出健康度。
 *
 * 只看水位会误判：缓冲 30 秒但补缓冲只有 0.5×，是在吃老本；
 * 只看倍率也会误判：缓冲只剩 1 秒、哪怕 5× 也马上要转圈。
 */
export function classifyBufferHealth(input: {
  bufferAhead?: number | null;
  refillRate?: number | null;
}): BufferHealth {
  const bufferAhead = input.bufferAhead;
  const refillRate = input.refillRate;
  if (bufferAhead == null || !Number.isFinite(bufferAhead)) return 'unknown';

  const starvingByRate = refillRate != null && refillRate < 0.8;
  const tightByRate = refillRate != null && refillRate < 1.2;

  if (bufferAhead < 2 || starvingByRate) return 'starving';
  if (bufferAhead < 8 || tightByRate) return 'tight';
  return 'good';
}

/** 卡顿次数的人话（0 次不说「卡顿」，直接说流畅） */
export function formatStallCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '未卡顿';
  return `卡顿 ${count} 次`;
}
