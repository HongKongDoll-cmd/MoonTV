import { NextResponse } from 'next/server';

import {
  clientIpFromRequest,
  createRateLimiter,
  rateLimitResponse,
} from '@/lib/rate-limit';
import { validateMediaUrl } from '@/lib/url-guard';

export const runtime = 'edge';

/**
 * 允许代理的图片域名。
 *
 * 这个接口在 middleware 里是**免登录**白名单，而它是把用户传入的 URL 直接
 * 回源的通用 GET 代理 —— 不限制就等于对外开了一个能打你内网
 * （`?url=http://169.254.169.254/...`）还能白烧你出口带宽的开放代理。
 * 实际用它的只有豆瓣图链路（`processImageUrl` 与回退链），所以锁死豆瓣域名即可。
 * 需要代理别的源时在这里加，别直接放开成任意 URL。
 */
const ALLOWED_IMAGE_HOSTS = [
  '*.doubanio.com',
  '*.doubanio.cmliussss.net',
  '*.doubanio.cmliussss.com',
];

/** 单 IP 每分钟允许的取图次数：正常翻页约 60 张/页，阈值留足余量 */
const RATE_LIMIT = createRateLimiter({
  windowMs: 60_000,
  max: 120,
});

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  const guard = validateMediaUrl(imageUrl, ALLOWED_IMAGE_HOSTS);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason ?? '不允许代理该地址' },
      { status: 403 }
    );
  }

  // 取不到 IP 时按共享桶处理，避免出现「无限额度」的情况
  const ip = clientIpFromRequest(request) || 'unknown';
  const limit = RATE_LIMIT.hit(ip);
  if (!limit.allowed) {
    return rateLimitResponse(limit, '取图过于频繁，请稍后再试');
  }

  try {
    const imageResponse = await fetch(imageUrl, {
      headers: {
        Referer: 'https://movie.douban.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type');

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    // 创建响应头
    const headers = new Headers();
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    // 设置缓存头（可选）
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000'); // 缓存半年
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    // 直接返回图片流
    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 }
    );
  }
}
