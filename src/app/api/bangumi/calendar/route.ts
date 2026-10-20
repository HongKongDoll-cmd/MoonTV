import { NextResponse } from 'next/server';

import {
  DEFAULT_IMAGE_PROXY_PREFIX,
  rewriteBangumiImageUrls,
} from '@/lib/bangumi-image-rewrite';

export const runtime = 'edge';

/**
 * 番组tv 放送日历的**服务端**代理。
 *
 * 以前前端浏览器直连 `https://api.bgm.tv/calendar`：国内常常连不上、还不返回
 * 也不报错（fetch 一直挂着），只能靠 12s 超时兜底；更要紧的是图片域名
 * `lain.bgm.tv` 同样直连，加载失败时首页「新番放送」整块没有海报。
 *
 * 现在改走这里：
 *   1. 服务端请求上游（部署机出口通常比用户浏览器更稳）；
 *   2. 顺手把响应体里的 `lain.bgm.tv` 图片地址改写成站内 `/api/image-proxy`，
 *      前端拿到的就是同源地址，不再有跨域 / 被墙 / 混合内容问题。
 *
 * ⚠️ 该接口**永不抛错**：任何失败都返回空数组 + 200，让首页那一块显示空态，
 * 不能因为它把整页拖垮（4.5.3 的教训）。
 */

/** 上游地址 */
const UPSTREAM = 'https://api.bgm.tv/calendar';

/** 单次请求超时：与前端旧直连的超时保持一致 */
const REQUEST_TIMEOUT_MS = 12_000;

/** 站内图片代理前缀，可用环境变量覆盖（自建反代等场景） */
function imageProxyBase(): string {
  return (
    process.env.NEXT_PUBLIC_BANGUMI_IMAGE_PROXY || DEFAULT_IMAGE_PROXY_PREFIX
  );
}

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(UPSTREAM, {
      signal: controller.signal,
      headers: {
        // Bangumi 对无 UA 的请求偶尔返回 403，带上浏览器 UA 更稳
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `上游返回 ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return NextResponse.json({ error: '上游响应异常' }, { status: 502 });
    }

    const rewritten = rewriteBangumiImageUrls(data, imageProxyBase());
    return NextResponse.json(rewritten, {
      headers: {
        // 放送日历一天才变一次，缓存 30 分钟足够，也别让上游被频繁打
        'Cache-Control': 'public, max-age=1800, s-maxage=1800',
      },
    });
  } catch {
    return NextResponse.json(
      { error: '无法连接番组tv' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
