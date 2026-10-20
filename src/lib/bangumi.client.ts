'use client';

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

/**
 * 番组tv 日历请求超时（毫秒）。
 *
 * 为什么必须有超时：这个请求以前是**浏览器直连** `api.bgm.tv`（无代理、无法
 * 改走服务端）。在国内常常连不上且**不返回也不报错**，fetch 会一直挂着。
 * 首页以前把它和三个豆瓣请求塞进同一个 `Promise.all`，它一挂，
 * 热门电影 / 热门剧集 / 热门综艺的数据全被丢弃 —— 表现就是「首页整片没有
 * 海报，但点进分类页正常」（分类页是独立请求，不依赖它）。
 *
 * 4.6.3 起改走站内 `/api/bangumi/calendar`（服务端转发 + 图片改写），
 * 超时仍保留作为兜底：自定义代理同样可能挂住。
 */
export const BANGUMI_REQUEST_TIMEOUT = 12000;

/** 站内默认代理地址 */
export const DEFAULT_BANGUMI_CALENDAR_URL = '/api/bangumi/calendar';

/**
 * 决定番组tv 日历的请求地址。
 *
 * 优先级：管理台配置（`RUNTIME_CONFIG.BANGUMI_PROXY`）> 环境变量兜底
 * （`NEXT_PUBLIC_BANGUMI_PROXY`，由 layout 注入 RUNTIME_CONFIG）> 站内默认。
 * 留空字符串一律按默认处理，避免把请求打到空地址上。
 *
 * @param runtimeConfig `window.RUNTIME_CONFIG`（可为 undefined，如 SSR 阶段）
 */
export function resolveBangumiCalendarUrl(
  runtimeConfig?: { BANGUMI_PROXY?: string } | null
): string {
  const configured =
    runtimeConfig?.BANGUMI_PROXY?.trim() || DEFAULT_BANGUMI_CALENDAR_URL;
  return configured;
}

/**
 * 取番组tv 放送日历。
 *
 * **永不抛错**：网络不可达 / 超时 / 非 200 / 返回体不是数组，一律返回空数组。
 * 这块数据只影响首页「新番放送」一个区块，不该有能力拖垮整页。
 */
export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  const url = resolveBangumiCalendarUrl(
    typeof window !== 'undefined'
      ? (window as unknown as { RUNTIME_CONFIG?: { BANGUMI_PROXY?: string } })
          .RUNTIME_CONFIG
      : undefined
  );

  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), BANGUMI_REQUEST_TIMEOUT)
    : null;

  try {
    const response = await fetch(url, {
      signal: controller?.signal,
    });
    if (!response?.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map((item: BangumiCalendarData) => ({
      ...item,
      items: item.items.filter(bangumiItem => bangumiItem.images),
    }));
  } catch {
    // 不可达 / 超时中断 / JSON 解析失败：返回空数组，不向上抛
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
