import { NextResponse } from 'next/server';

import { fetchLibrarySubtitle } from '@/lib/library-image.server';
import { resolveOpenListConfig } from '@/lib/media-library.server';
import { isSubtitleFile } from '@/lib/subtitle';

export const runtime = 'edge';

/**
 * 影库字幕文件代理（4.5.7）。
 *
 * ## 为什么字幕必须走服务端
 *
 * 影库直链（网盘 raw_url 或 OpenList 的 `/d/`）在浏览器里是**跨域**的，
 * 而 ArtPlayer 拉字幕用的是 `fetch` —— 对方不回
 * `Access-Control-Allow-Origin` 就会直接失败，字幕永远 0 条。
 * AList / OpenList 的下载端点默认不带 CORS 头，所以这不是「mock 的问题」，
 * 真实部署同样会挂。
 *
 * 由服务端带影库凭据取回、补上 CORS 头再吐给浏览器，一并解决：
 *   - 跨域被拦
 *   - 凭据不必下发到前端
 *   - 可加大小/类型校验
 *
 * 只放行**字幕类扩展名**（见 `isSubtitleFile`），不开放任意文件下载。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path') || '';

  if (!path) {
    return NextResponse.json({ error: '缺少字幕路径' }, { status: 400 });
  }

  const name = path.split('/').filter(Boolean).pop() || '';
  if (!isSubtitleFile(name)) {
    return NextResponse.json(
      { error: '只允许读取字幕文件（.srt / .ass / .ssa / .vtt / .smi / .sub）' },
      { status: 400 }
    );
  }

  const config = await resolveOpenListConfig(request.headers.get('cookie'));
  if (!config?.baseUrl) {
    return NextResponse.json(
      { error: '尚未配置私人影库，请到「影库」页面填写，或由管理员在后台配置' },
      { status: 400 }
    );
  }

  const result = await fetchLibrarySubtitle(config, path);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? '读取字幕失败' },
      { status: result.status ?? 502 }
    );
  }

  const headers = new Headers({
    // 字幕要跨域被播放器取用；带宽成本极低（几十 KB），缓存一小时
    'Cache-Control': 'private, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  });
  if (result.contentType) headers.set('Content-Type', result.contentType);

  return new Response(result.body, { status: 200, headers });
}
