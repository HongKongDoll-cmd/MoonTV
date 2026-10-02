/**
 * 影库封面的**服务端读取**（只可被服务端路由引用）。
 *
 * 与 `library-image.ts` 分开的原因同 `media-library.server.ts`：这里要
 * `import { getConfig }` / 发起真实网络请求，浏览器组件引用会在打包/运行时炸。
 */

import type { EmbyConfig } from './emby';
import { pickCoverFromItems } from './library-image';
import {
  type OpenListConfig,
  buildPlayableUrl,
  joinOpenListPath,
  normalizeBaseUrl,
  requestOpenList,
} from './openlist';
import { validateMediaUrl } from './url-guard';

/** 封面图回源超时：海报不该拖住页面列表渲染 */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

export interface LibraryImageResult {
  ok: boolean;
  status: number;
  error?: string;
  body?: ArrayBuffer;
  contentType?: string;
}

/**
 * 读取影库里的一张图片。
 *
 * 流程：拿令牌调 `fs/get` 换直链（带签名）→ 校验该地址（内网默认拒绝）→
 * 回源取字节。全程令牌只在服务端，浏览器只看到 `/api/library-image?p=...`。
 */
export async function fetchLibraryImage(
  config: OpenListConfig,
  path: string,
  maxBytes: number
): Promise<LibraryImageResult> {
  const info = await requestOpenList(config, 'get', path);
  if (!info.ok) {
    return {
      ok: false,
      status: info.status ?? 502,
      error: info.error ?? '读取影库失败',
    };
  }

  const entry = (info.data?.data ?? {}) as Record<string, unknown>;
  if (entry?.is_dir === true) {
    return { ok: false, status: 400, error: '不是图片文件' };
  }

  const target = buildPlayableUrl(
    config.baseUrl,
    path,
    typeof entry?.sign === 'string' ? entry.sign : undefined,
    typeof entry?.raw_url === 'string' ? entry.raw_url : undefined
  );
  if (!target) {
    return { ok: false, status: 400, error: '影库地址无效' };
  }

  const guard = validateMediaUrl(target, undefined, {
    allowPrivateNetwork: config.allowPrivateNetwork === true,
  });
  if (!guard.ok) {
    return { ok: false, status: 403, error: guard.reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(target, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: 502, error: '取回封面失败' };
    }

    const contentType = response.headers.get('content-type') ?? '';
    // 只放行图片：影库里同名 exe / zip 不该被当成封面吐给浏览器
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, status: 415, error: '不是图片内容' };
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      return { ok: false, status: 413, error: '封面过大' };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return { ok: false, status: 413, error: '封面过大' };
    }

    return { ok: true, status: 200, body: buffer, contentType };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted ? '取回封面超时' : '取回封面失败',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 抓 Emby 海报的回源逻辑与 OpenList 相同，抽出来复用 */
async function fetchImageBytes(
  target: string,
  maxBytes: number,
  allowPrivateNetwork: boolean
): Promise<LibraryImageResult> {
  const guard = validateMediaUrl(target, undefined, { allowPrivateNetwork });
  if (!guard.ok) {
    return { ok: false, status: 403, error: guard.reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(target, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: 502, error: '取回封面失败' };
    }

    const contentType = response.headers.get('content-type') ?? '';
    // 只放行图片：影库里同名 exe / zip 不该被当成封面吐给浏览器
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, status: 415, error: '不是图片内容' };
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      return { ok: false, status: 413, error: '封面过大' };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return { ok: false, status: 413, error: '封面过大' };
    }

    return { ok: true, status: 200, body: buffer, contentType };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted ? '取回封面超时' : '取回封面失败',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读取 Emby 条目的海报（`/Items/{id}/Images/Primary`）。
 *
 * api_key 由服务端补，浏览器永远接触不到。
 */
export async function fetchEmbyImage(
  config: EmbyConfig,
  itemId: string,
  maxBytes: number
): Promise<LibraryImageResult> {
  const base = normalizeBaseUrl(config?.baseUrl ?? '');
  if (!base) return { ok: false, status: 400, error: '缺少影库地址' };
  if (!itemId) return { ok: false, status: 400, error: '缺少图片条目 ID' };

  const target = `${base}/Items/${encodeURIComponent(itemId)}/Images/Primary?api_key=${encodeURIComponent(config.token ?? '')}`;
  return fetchImageBytes(target, maxBytes, config.allowPrivateNetwork === true);
}

/**
 * 在一个影库目录下找封面，返回封面文件的**影库内绝对路径**（没有则空串）。
 *
 * 目录 Scenario：剧集目录同级通常就有 `poster.jpg`；
 * 文件 Scenario：单个视频要在它所在目录里按同名规则找。
 */
export async function findLibraryCoverPath(
  config: OpenListConfig,
  dirPath: string,
  targetName?: string
): Promise<string> {
  const listing = await requestOpenList(config, 'list', dirPath);
  if (!listing.ok) return '';
  const content = listing.data?.data?.content;
  if (!Array.isArray(content)) return '';

  const coverName = pickCoverFromItems(content, targetName);
  if (!coverName) return '';
  return joinOpenListPath(dirPath, coverName);
}

// ---------------------------------------------------------------------------
// 字幕文件（4.5.7）
// ---------------------------------------------------------------------------

/** 字幕回源超时：字幕都很小，但网盘抽风时不能无限等 */
const SUBTITLE_FETCH_TIMEOUT_MS = 10_000;

/** 字幕体积上限：正常 srt/ass 几十 KB，1MB 足够异常的整季合集 */
const SUBTITLE_MAX_BYTES = 1024 * 1024;

export interface LibrarySubtitleResult {
  ok: boolean;
  status: number;
  error?: string;
  body?: ArrayBuffer;
  contentType?: string;
}

/** 按扩展名给字幕一个明确的 Content-Type（上游常常只给 text/plain） */
function subtitleContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) {
    return 'text/x-ssa; charset=utf-8';
  }
  if (lower.endsWith('.vtt')) return 'text/vtt; charset=utf-8';
  if (lower.endsWith('.sub')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.smi')) return 'application/x-smi; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

/**
 * 读取影库里的一个字幕文件。
 *
 * 与封面的差别只有两点：不做「必须是图片」的内容类型校验（字幕上游类型
 * 很杂），改成按**扩展名**判定；体积上限小得多。
 * 其余流程一致：`fs/get` 换直链 → 校验地址 → 带令牌回源取字节。
 */
export async function fetchLibrarySubtitle(
  config: OpenListConfig,
  path: string
): Promise<LibrarySubtitleResult> {
  const name = path.split('/').filter(Boolean).pop() || '';

  const info = await requestOpenList(config, 'get', path);
  if (!info.ok) {
    return {
      ok: false,
      status: info.status ?? 502,
      error: info.error ?? '读取影库失败',
    };
  }

  const entry = (info.data?.data ?? {}) as Record<string, unknown>;
  if (entry?.is_dir === true) {
    return { ok: false, status: 400, error: '不是字幕文件' };
  }

  const target = buildPlayableUrl(
    config.baseUrl,
    path,
    typeof entry?.sign === 'string' ? entry.sign : undefined,
    typeof entry?.raw_url === 'string' ? entry.raw_url : undefined
  );
  if (!target) {
    return { ok: false, status: 400, error: '影库地址无效' };
  }

  const guard = validateMediaUrl(target, undefined, {
    allowPrivateNetwork: config.allowPrivateNetwork === true,
  });
  if (!guard.ok) {
    return { ok: false, status: 403, error: guard.reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBTITLE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(target, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: 502, error: '取回字幕失败' };
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > SUBTITLE_MAX_BYTES) {
      return { ok: false, status: 413, error: '字幕文件过大' };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > SUBTITLE_MAX_BYTES) {
      return { ok: false, status: 413, error: '字幕文件过大' };
    }

    return {
      ok: true,
      status: 200,
      body: buffer,
      contentType: subtitleContentType(name),
    };
  } catch {
    return { ok: false, status: 502, error: '取回字幕失败' };
  } finally {
    clearTimeout(timer);
  }
}
