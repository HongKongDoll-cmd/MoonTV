/* eslint-disable no-console */

import { NextResponse } from 'next/server';

import { getAvailableApiSites, getCacheTime } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { memoizeAsync } from '@/lib/memoize-async';

/**
 * 剧情简介接口（4.8.1）。
 *
 * 为什么不在搜索结果里直接带：采集站的搜索接口经常把 `vod_content` 截断甚至留空，
 * 完整简介只在**详情**接口里有。卡片菜单打开时才去取，用户不看就不请求。
 *
 * 用 `memoizeAsync` 缓存：同一部片子反复右键（或同一页多张卡片指向同一部）
 * 只回源一次；失败不缓存，网络抖一下不会变成"永久拿不到简介"。
 */

/** 简介缓存键的分隔符：用 NUL，影片 id 不可能包含它 */
const KEY_SEP = '\u0000';

/** 服务端进程内缓存。上限 200 条，30 分钟过期 —— 简介基本不变，可以给长一点。 */
const loadIntro = memoizeAsync(
  async (key: string): Promise<string> => {
    const at = key.indexOf(KEY_SEP);
    if (at <= 0) return '';
    const source = key.slice(0, at);
    const id = key.slice(at + 1);

    const apiSites = await getAvailableApiSites();
    const apiSite = apiSites.find((site) => site.key === source);
    if (!apiSite) return '';

    const detail = await getDetailFromApi(apiSite, id);
    // desc 在 downstream 里已经过 cleanHtmlTags 清洗
    return typeof detail?.desc === 'string' ? detail.desc.trim() : '';
  },
  { max: 200 }
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');
  const id = searchParams.get('id');

  if (!source || !id) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  try {
    const intro = await loadIntro(`${source}${KEY_SEP}${id}`);
    const cacheTime = await getCacheTime();

    return NextResponse.json(
      { intro },
      {
        headers: {
          // 简介变化极少，缓存久一点；查询参数已包含 source + id，可安全共用
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    // 取不到简介不该让卡片菜单报错：返回空串，前端显示「暂无简介」
    console.warn('获取剧情简介失败:', error);
    return NextResponse.json({ intro: '' });
  }
}
