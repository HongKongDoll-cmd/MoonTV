/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { normalizeMediaLibraryConfig } from '@/lib/media-library';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存储进行管理员配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      BangumiProxy,
      DisableYellowFilter,
      DanmakuApiBaseUrl,
      TVBoxEnabled,
      TVBoxPassword,
      PlaybackSaveInterval,
      MediaLibrary,
    } = body as {
      SiteName: string;
      Announcement: string;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      BangumiProxy?: string;
      DisableYellowFilter: boolean;
      DanmakuApiBaseUrl?: string;
      TVBoxEnabled?: boolean;
      TVBoxPassword?: string;
      PlaybackSaveInterval?: number;
      MediaLibrary?: unknown;
    };

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      (BangumiProxy !== undefined && typeof BangumiProxy !== 'string') ||
      typeof DisableYellowFilter !== 'boolean' ||
      (DanmakuApiBaseUrl !== undefined &&
        typeof DanmakuApiBaseUrl !== 'string') ||
      (TVBoxEnabled !== undefined && typeof TVBoxEnabled !== 'boolean') ||
      (TVBoxPassword !== undefined && typeof TVBoxPassword !== 'string') ||
      (PlaybackSaveInterval !== undefined &&
        (typeof PlaybackSaveInterval !== 'number' ||
          !Number.isFinite(PlaybackSaveInterval) ||
          PlaybackSaveInterval < 1 ||
          PlaybackSaveInterval > 3600)) ||
      // 影库配置要么不传（保持原值），要么是对象或 null（清空）
      (MediaLibrary !== undefined &&
        MediaLibrary !== null &&
        typeof MediaLibrary !== 'object')
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await getConfig();
    const storage = getStorage();

    // 权限校验
    if (username !== process.env.USERNAME) {
      // 管理员
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 更新缓存中的站点设置
    // ⚠️ 必须先展开原配置：这个对象是整体覆盖，漏掉未在此处列出的字段
    // （例如 4.6.1 的 LocalSettingsSyncMode）会被静默重置成默认值，
    // 表现为「关掉的开关在保存其他设置后自己开了」。
    adminConfig.SiteConfig = {
      ...adminConfig.SiteConfig,
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      // 不传 = 保持原值（老客户端不会误清空已配的代理）
      BangumiProxy:
        BangumiProxy === undefined
          ? adminConfig.SiteConfig.BangumiProxy
          : BangumiProxy,
      DisableYellowFilter,
      DanmakuApiBaseUrl,
      TVBoxEnabled,
      TVBoxPassword,
      PlaybackSaveInterval,
      // 不传 = 保持原值（老客户端/局部更新不会误清空）；传 null = 清空；
      // 传对象但地址为空 = 归一成 null（等于没配）
      MediaLibrary:
        MediaLibrary === undefined
          ? adminConfig.SiteConfig.MediaLibrary
          : normalizeMediaLibraryConfig(MediaLibrary),
    };

    // 同步更新 ConfigFile 中的 cache_time
    try {
      const configFileData = JSON.parse(adminConfig.ConfigFile);
      configFileData.cache_time = SiteInterfaceCacheTime;
      adminConfig.ConfigFile = JSON.stringify(configFileData);
    } catch (e) {
      console.error('更新 ConfigFile 中的 cache_time 失败:', e);
    }

    // 写入数据库
    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不缓存结果
        },
      }
    );
  } catch (error) {
    console.error('更新站点配置失败:', error);
    return NextResponse.json(
      {
        error: '更新站点配置失败',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
