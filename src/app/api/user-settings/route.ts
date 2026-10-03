/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import type { SyncedSetting } from '@/lib/settings-sync';
import { isValidValue, SYNCABLE_SETTINGS } from '@/lib/settings-sync';

export const runtime = 'edge';

/** localstorage 模式没有服务端存储，同步无从谈起 */
function isSyncSupported(): boolean {
  const type = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  return type !== 'localstorage';
}

/** 管理员总开关（4.6.1 起默认开启，可在管理台关闭） */
async function isSyncEnabled(): Promise<boolean> {
  try {
    const { getConfig } = await import('@/lib/config');
    const config = await getConfig();
    const mode = (config.SiteConfig as Record<string, unknown> | undefined)
      ?.LocalSettingsSyncMode;
    if (mode === 'off' || mode === 'false') return false;
    return true;
  } catch {
    // 读不到配置时不阻塞同步（宁可多同步，也不要静默失效）
    return true;
  }
}

/** 把请求体收敛成合法的 SyncedSetting[]（只留白名单内的键） */
function sanitize(input: unknown): SyncedSetting[] {
  if (!Array.isArray(input)) return [];
  const known = new Set(Object.values(SYNCABLE_SETTINGS));
  const out: SyncedSetting[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const { key, value, updatedAt } = item as Record<string, unknown>;
    if (typeof key !== 'string' || !known.has(key)) continue;
    if (!isValidValue(value as string)) continue;
    const ts = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : Date.now();
    out.push({ key, value: value as string, updatedAt: ts });
  }
  return out;
}

/**
 * GET /api/user-settings
 *
 * 返回该用户云端的设置副本；未同步过则返回空数组。
 * `?probe=1` 只返回「是否可用/是否开启」，不取数据 —— 前端初始化时用。
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isSyncSupported()) {
      return NextResponse.json({ supported: false, enabled: false, settings: [] });
    }

    const enabled = await isSyncEnabled();
    if (!enabled) {
      return NextResponse.json({ supported: true, enabled: false, settings: [] });
    }

    if (request.nextUrl.searchParams.get('probe') === '1') {
      return NextResponse.json({ supported: true, enabled: true });
    }

    const settings = await db.getUserSettings(authInfo.username);
    return NextResponse.json({ supported: true, enabled: true, settings });
  } catch (error) {
    console.error('获取云端设置失败:', error);
    // 同步失败不该让页面报错 —— 返回空副本，客户端就当「还没同步过」
    return NextResponse.json({ supported: true, enabled: true, settings: [] });
  }
}

/**
 * POST /api/user-settings
 *
 * 覆盖式保存：传什么就存什么，不传的项视为「已删除」。
 * 客户端会先 GET 再合并，所以这里不用做增量合并。
 */
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isSyncSupported()) {
      return NextResponse.json({ error: '当前存储类型不支持同步' }, { status: 400 });
    }
    if (!(await isSyncEnabled())) {
      return NextResponse.json({ error: '管理员已关闭设置同步' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const settings = sanitize((body as { settings?: unknown })?.settings ?? body);
    await db.setUserSettings(authInfo.username, settings);
    return NextResponse.json({ ok: true, count: settings.length });
  } catch (error) {
    console.error('保存云端设置失败:', error);
    return NextResponse.json({ error: '保存失败' }, { status: 500 });
  }
}

/** DELETE /api/user-settings —— 清空云端副本（设置页的「重置同步」用） */
export async function DELETE(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await db.setUserSettings(authInfo.username, []);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('清空云端设置失败:', error);
    return NextResponse.json({ error: '清空失败' }, { status: 500 });
  }
}
