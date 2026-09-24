/* eslint-disable no-console */

import { NextResponse } from 'next/server';

import {
  listEmbyLibraries,
  listEmbyUsers,
  pingEmby,
  searchEmbyItems,
} from '@/lib/emby.server';
import { type EmbyConfig,toEmbyConfig } from '@/lib/media-library';
import { getServerMediaLibraryConfig } from '@/lib/media-library.server';

export const runtime = 'edge';

/**
 * Emby / Jellyfin 影库转发（同源、无 CORS、api_key 不进浏览器侧 JS）。
 *
 * `action`:
 *   - `ping`      连通性测试（管理台测试按钮）。
 *   - `users`     列影库用户（管理台下拉，4.4.6 起不用手填用户 ID）。
 *   - `libraries` 列媒体库（管理台多选，限定搜索范围）。
 *   - `search`    影库搜索（query 参数，可选 libraryIds 限定库）。
 *
 * ⚠️ 请求体可带 baseUrl/token/allowPrivateNetwork/userId/libraryIds —— 管理员
 * **保存之前**就要能试，所以表单参数优先，没带才回退站点级配置。
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    action?: string;
    baseUrl?: string;
    token?: string;
    userId?: string;
    allowPrivateNetwork?: boolean;
    libraryIds?: unknown;
    query?: string;
  };

  // 表单参数优先（测试未保存的配置），否则用站点级配置
  let config: EmbyConfig | null = null;
  if (payload?.baseUrl && typeof payload.baseUrl === 'string') {
    config = {
      baseUrl: payload.baseUrl,
      token: typeof payload.token === 'string' ? payload.token : '',
      userId: typeof payload.userId === 'string' ? payload.userId : '',
      libraryIds: Array.isArray(payload.libraryIds)
        ? payload.libraryIds.filter((id): id is string => typeof id === 'string')
        : [],
      allowPrivateNetwork: payload.allowPrivateNetwork === true,
    };
  } else {
    const serverConfig = await getServerMediaLibraryConfig();
    config = serverConfig?.Type === 'emby' ? toEmbyConfig(serverConfig) : null;
  }

  if (!config?.baseUrl) {
    return NextResponse.json(
      { error: '尚未配置 Emby 影库，请先在管理台填写地址与 API Key' },
      { status: 400 }
    );
  }

  if (payload.action === 'ping') {
    const result = await pingEmby(config);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  // 用户与媒体库的下拉：保存之前就要能拉，所以走的是表单参数那份 config
  if (payload.action === 'users') {
    const result = await listEmbyUsers(config);
    return NextResponse.json(result, { status: result.ok ? 200 : result.status ?? 502 });
  }

  if (payload.action === 'libraries') {
    const result = await listEmbyLibraries(config);
    return NextResponse.json(result, { status: result.ok ? 200 : result.status ?? 502 });
  }

  if (payload.action === 'search') {
    const query = (payload.query ?? '').trim();
    if (!query) {
      return NextResponse.json({ error: '缺少搜索词' }, { status: 400 });
    }
    const { results, error } = await searchEmbyItems(config, query);
    if (error) {
      return NextResponse.json({ error, results: [] }, { status: 502 });
    }
    return NextResponse.json({ results });
  }

  return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
}
