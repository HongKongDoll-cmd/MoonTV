/**
 * 4.6.2 通知的**真实数据**验证。
 *
 * ## 为什么用快照而不是直接打接口
 * 验证分两步：
 *   1. `docs/tools/check-notifications.mjs` 里的 curl 流程**已经跑通**（登录 200、
 *      写入今日更新 200、读回字段保真），把读回的真实响应存成快照；
 *   2. 这个测试读快照，用**组件同款纯函数**跑判定。
 *
 * 为什么不直接在 jest 里打接口：Jest 27 的 jsdom 沙箱没有全局 `fetch`，
 * `execFileSync(curl.exe)` 会被沙箱以 EBUSY 拦下，`undici.request` 在 jsdom 里
 * 会挂住直到超时 —— 三条路都试过（各花了一轮），所以改成「curl 采快照 + 纯函数判定」。
 * 验证的仍是真实链路的数据（真实存储序列化出来的形状），只有浏览器渲染交给人工看。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildNotifications, isWorthNotifying } from '../update-notification';

interface SampleItem {
  source: string;
  id: string;
  title: string;
  source_name?: string;
  poster?: string;
  episodes?: number;
  watchedEpisodes?: number;
  unwatchedEpisodes?: number;
  newEpisodes?: number;
}

const snapshotPath = join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'fixtures',
  'today-updated-sample.json'
);

function loadSample(): { date: string; items: SampleItem[] } {
  return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
}

describe('更新通知 · 真实数据验证', () => {
  const sample = loadSample();
  const items = sample.items || [];

  test('快照来自真实接口且字段保真', () => {
    expect(typeof sample.date).toBe('string');
    expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(items).toHaveLength(2);

    const withNew = items.find((i) => i.title === '通知测试剧');
    expect(withNew).toBeDefined();
    expect(withNew!.newEpisodes).toBe(2);
    expect(withNew!.unwatchedEpisodes).toBe(2);
    expect(withNew!.watchedEpisodes).toBe(10);
    expect(withNew!.source_name).toBe('B站');

    const finished = items.find((i) => i.title === '已看完的剧');
    expect(finished!.newEpisodes).toBe(0);
    expect(finished!.unwatchedEpisodes).toBe(0);
    expect(finished!.watchedEpisodes).toBe(26);
  });

  test('真实数据能生成通知且字段完整可跳转', () => {
    const list = buildNotifications(items, {});
    expect(list).toHaveLength(1);

    const [n] = list;
    expect(n.title).toBe('通知测试剧');
    expect(n.sourceName).toBe('B站');
    expect(n.text).toBe('新增 2 集，还有 2 集没看');
    expect(n.key).toBe('bilibili:ep-n1');
    expect(n.href).toContain('/play?');
    expect(n.href).toContain('source=bilibili');
    expect(n.href).toContain('id=ep-n1');
    // href 里的中文要正确编码，解析回来不能被截断
    const url = new URL(n.href, 'http://x');
    expect(url.searchParams.get('title')).toBe('通知测试剧');
  });

  test('「全看完且无新增」不产生通知（防噪音）', () => {
    const list = buildNotifications(items, {});
    expect(list.some((n) => n.title === '已看完的剧')).toBe(false);

    // 判定口径也直接锁住
    expect(
      isWorthNotifying({ newEpisodes: 0, unwatchedEpisodes: 0, watchedEpisodes: 26 })
    ).toBe(false);
    expect(isWorthNotifying({ newEpisodes: 2, unwatchedEpisodes: 2 })).toBe(true);
  });

  test('已读去重：当天读过不提醒，跨天有新集才提醒', () => {
    const [first] = buildNotifications(items, {});
    expect(first).toBeDefined();

    // 当天读过 → 安静
    expect(buildNotifications(items, { [first.key]: Date.now() })).toHaveLength(0);
    // 昨天读过 → 今天有新集仍要提醒
    expect(
      buildNotifications(items, {
        [first.key]: Date.now() - 24 * 60 * 60 * 1000,
      })
    ).toHaveLength(1);
  });
});
