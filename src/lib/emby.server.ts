/**
 * Emby / Jellyfin 影库的**服务端请求**（只可被服务端路由引用）。
 *
 * 所有请求都带 `api_key`（服务端持有），浏览器侧只看到 `/api/emby`、
 * `/api/library-image`、播放直链三类地址。依赖只有 `fetch`，部署无关。
 */

import {
  type EmbyConfig,
  type EmbyItem,
  type EmbyLibrary,
  type EmbyUser,
  buildEmbySearchParams,
  mapEmbyDetailToResult,
  mapEmbyItemsToSearchResults,
  mapEmbyLibraries,
  mapEmbyUsers,
  mergeEmbyItems,
} from './emby';
import type { SearchResult } from './types';
import { validateMediaUrl } from './url-guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 单次请求超时：家庭 NAS 冷启动慢，但太长会拖住页面 */
const REQUEST_TIMEOUT_MS = 10_000;

/** 搜索最多取多少条（与 OpenList 的 SEARCH_PAGE_SIZE 对齐） */
const SEARCH_LIMIT = 24;

function checkBaseUrl(
  config: EmbyConfig
): { ok: true; base: string } | { ok: false; status: number; error?: string } {
  const base = normalizeBase(config?.baseUrl ?? '');
  if (!base) return { ok: false, status: 400, error: '缺少影库地址' };
  const guard = validateMediaUrl(base, undefined, {
    allowPrivateNetwork: config?.allowPrivateNetwork === true,
  });
  if (!guard.ok) return { ok: false, status: 403, error: guard.reason };
  return { ok: true, base };
}

/** Emby 地址归一（同 OpenList：补协议、去尾斜杠） */
function normalizeBase(raw: string): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '');
}

/** 服务端 GET 一个 Emby JSON 接口 */
async function requestEmbyJson<T = any>(
  config: EmbyConfig,
  path: string,
  params: Record<string, string> = {}
): Promise<{ ok: boolean; status?: number; error?: string; data?: T }> {
  const checked = checkBaseUrl(config);
  if (!checked.ok) return checked;

  const url = new URL(`${checked.base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // api_key 统一在最后补，调用方不用重复传
  if (config.token) url.searchParams.set('api_key', config.token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: 502, error: `影库返回 ${response.status}` };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted ? '连接影库超时' : '无法连接影库',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取 Emby 用户 ID。
 *
 * 部分接口（搜索、剧集展开）需要 userId；管理员没填时取第一个用户
 * （家庭影库几乎都是单用户部署）。
 */
export async function getEmbyUserId(config: EmbyConfig): Promise<string> {
  if (config.userId) return config.userId;
  const res = await requestEmbyJson<any[]>(config, '/Users');
  const first = Array.isArray(res.data) ? res.data.find((u) => u?.Id) : null;
  return first?.Id ? String(first.Id) : '';
}

/**
 * 用这份配置做一次连通性测试。
 *
 * 返回可读的文本（管理台测试按钮直接展示），顺便把解析到的 userId 带回去。
 */
export async function pingEmby(
  config: EmbyConfig
): Promise<{ ok: boolean; message: string; userId?: string }> {
  const checked = checkBaseUrl(config);
  if (!checked.ok) return { ok: false, message: checked.error ?? '配置无效' };

  const res = await requestEmbyJson<any[]>(config, '/Users');
  if (!res.ok) return { ok: false, message: res.error ?? '连接失败' };
  if (!Array.isArray(res.data)) return { ok: false, message: '影库响应异常' };

  const first = res.data.find((u) => u?.Id);
  return {
    ok: true,
    message: `连接成功：影库可访问${first?.Name ? `（用户 ${first.Name}）` : ''}`,
    userId: first?.Id ? String(first.Id) : undefined,
  };
}

/**
 * 列影库里的用户（管理台下拉用）。
 *
 * 家庭影库多账号很常见（父母一个、小孩一个，权限不同），
 * 管理员得能挑一个来搜，而不是只知道「取第一个用户」。
 */
export async function listEmbyUsers(
  config: EmbyConfig
): Promise<{ ok: boolean; users: EmbyUser[]; error?: string; status?: number }> {
  const res = await requestEmbyJson<unknown[]>(config, '/Users');
  if (!res.ok) return { ok: false, users: [], error: res.error, status: res.status };
  return { ok: true, users: mapEmbyUsers(res.data) };
}

/**
 * 列影库里的媒体库（管理台多选用）。
 *
 * 顺带把实际使用的 userId 回给调用方：管理员没填时这里已经解析过了，
 * 界面上要显示「按哪个用户在看」。
 */
export async function listEmbyLibraries(
  config: EmbyConfig
): Promise<{
  ok: boolean;
  libraries: EmbyLibrary[];
  userId?: string;
  error?: string;
  status?: number;
}> {
  const userId = await getEmbyUserId(config);
  if (!userId) {
    return { ok: false, libraries: [], error: '取不到影库用户', status: 502 };
  }
  const res = await requestEmbyJson<unknown>(
    config,
    `/Users/${encodeURIComponent(userId)}/Views`
  );
  if (!res.ok) {
    return { ok: false, libraries: [], error: res.error, status: res.status };
  }
  return { ok: true, libraries: mapEmbyLibraries(res.data), userId };
}

/**
 * 影库搜索：只收电影与剧集，映射成与在线源一致的 `SearchResult`。
 *
 * 配了媒体库时**逐库并发**再合并：Emby 的 `ParentId` 只接受单值，
 * 没有「一次搜多个库」的参数。单个库失败不算整体失败（别的库还能出结果），
 * 只有全挂了才报错。
 */
export async function searchEmbyItems(
  config: EmbyConfig,
  query: string
): Promise<{ results: SearchResult[]; error?: string }> {
  const userId = await getEmbyUserId(config);
  if (!userId) return { results: [], error: '取不到影库用户' };

  const path = `/Users/${encodeURIComponent(userId)}/Items`;
  const libraryIds = config.libraryIds ?? [];

  if (libraryIds.length === 0) {
    const res = await requestEmbyJson<{ Items?: EmbyItem[]; TotalRecordCount?: number }>(
      config,
      path,
      buildEmbySearchParams(query, SEARCH_LIMIT)
    );
    if (!res.ok) return { results: [], error: res.error };
    return { results: mapEmbyItemsToSearchResults(res.data?.Items) };
  }

  const settled = await Promise.all(
    libraryIds.map((libraryId) =>
      requestEmbyJson<{ Items?: EmbyItem[] }>(
        config,
        path,
        buildEmbySearchParams(query, SEARCH_LIMIT, libraryId)
      )
    )
  );

  const batches: unknown[] = [];
  let lastError: string | undefined;
  for (const res of settled) {
    if (res.ok) batches.push(res.data?.Items ?? []);
    else lastError = res.error ?? lastError;
  }
  // 全挂了才报错；部分库可用就照常出结果
  if (batches.length === 0) {
    return { results: [], error: lastError ?? '搜索影库失败' };
  }

  return {
    results: mapEmbyItemsToSearchResults(mergeEmbyItems(batches, SEARCH_LIMIT)),
  };
}

/** 影库详情：电影 → 单集；剧集 → 展开全部 Episode（自然序由 Emby 保证） */
export async function getEmbyDetail(
  config: EmbyConfig,
  itemId: string
): Promise<{ result: SearchResult | null; error?: string; status?: number }> {
  const userId = await getEmbyUserId(config);
  if (!userId) return { result: null, error: '取不到影库用户', status: 502 };

  const res = await requestEmbyJson<EmbyItem>(
    config,
    `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`,
    { Fields: 'MediaSources,Path' }
  );
  if (!res.ok) return { result: null, error: res.error, status: res.status };
  const item = res.data;
  if (!item?.Id) return { result: null, error: '影库里没有这个条目', status: 404 };

  // 剧集再展开 Episode 列表
  let episodeItems: EmbyItem[] | null = null;
  if (item.Type === 'Series') {
    const eps = await requestEmbyJson<{ Items?: EmbyItem[] }>(
      config,
      `/Shows/${encodeURIComponent(item.Id)}/Episodes`,
      { userId, Fields: 'MediaSources' }
    );
    if (!eps.ok) {
      return { result: null, error: eps.error ?? '展开剧集失败', status: eps.status };
    }
    episodeItems = eps.data?.Items ?? [];
  }

  const result = mapEmbyDetailToResult(item, episodeItems, {
    baseUrl: config.baseUrl,
    token: config.token,
  });
  if (!result) {
    return { result: null, error: '该条目没有可播放的媒体', status: 404 };
  }
  return { result };
}
