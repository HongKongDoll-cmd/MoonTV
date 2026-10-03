import {
  buildNotificationHref,
  buildNotificationKey,
  buildNotifications,
  buildNotificationText,
  canNotifySystem,
  isWorthNotifying,
  markAsRead,
  NOTIFICATION_READ_KEY,
  readReadMap,
  writeReadMap,
} from '../update-notification';

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    _map: map,
  };
}

/** 构造一条今日更新记录 */
function item(over: Partial<Parameters<typeof buildNotifications>[0][number]> = {}) {
  return {
    source: 'bilibili',
    id: 'ep1',
    title: '庆余年',
    source_name: 'B站',
    poster: 'https://img/1.jpg',
    newEpisodes: 0,
    unwatchedEpisodes: 0,
    watchedEpisodes: 12,
    ...over,
  };
}

describe('isWorthNotifying', () => {
  test('有新增集 → 值得', () => {
    expect(isWorthNotifying({ newEpisodes: 2 })).toBe(true);
  });

  test('有未看集 → 值得', () => {
    expect(isWorthNotifying({ unwatchedEpisodes: 3 })).toBe(true);
  });

  test('在追且完全没看 → 值得', () => {
    expect(isWorthNotifying({ isFollowed: true, watchedEpisodes: 0 })).toBe(true);
  });

  test('看完且无新增 → 不值得（噪音）', () => {
    expect(
      isWorthNotifying({ newEpisodes: 0, unwatchedEpisodes: 0, watchedEpisodes: 26 })
    ).toBe(false);
  });

  test('没在追且完全没看 → 不值得', () => {
    expect(isWorthNotifying({ watchedEpisodes: 0 })).toBe(false);
  });
});

describe('buildNotificationKey / buildNotificationHref', () => {
  test('key 跨天稳定（不同 id 是不同 key）', () => {
    expect(buildNotificationKey('a', '1')).toBe('a:1');
    expect(buildNotificationKey('a', '1')).not.toBe(buildNotificationKey('a', '2'));
  });

  test('key 里的斜杠空格被清理', () => {
    expect(buildNotificationKey('openlist', '/大目录/第001集.mkv')).toBe(
      'openlist:_大目录_第001集.mkv'
    );
  });

  test('href 正确编码中文与特殊字符', () => {
    const href = buildNotificationHref('openlist', '/大目录/a.mkv', '庆余年');
    expect(href).toContain('source=openlist');
    expect(href).toContain(encodeURIComponent('庆余年'));
    // 解析回来应该与原值一致（不能被截断）
    const url = new URL(href, 'http://x');
    expect(url.searchParams.get('title')).toBe('庆余年');
    expect(url.searchParams.get('id')).toBe('/大目录/a.mkv');
  });
});

describe('buildNotificationText', () => {
  test('有新增集', () => {
    expect(buildNotificationText({ newEpisodes: 2 })).toBe('新增 2 集');
  });

  test('新增 + 未看', () => {
    expect(buildNotificationText({ newEpisodes: 2, unwatchedEpisodes: 5 })).toBe(
      '新增 2 集，还有 5 集没看'
    );
  });

  test('只有未看', () => {
    expect(buildNotificationText({ unwatchedEpisodes: 3 })).toBe('还有 3 集没看');
  });

  test('兜底文案', () => {
    expect(buildNotificationText({})).toBe('有新的内容可以看');
  });
});

describe('buildNotifications', () => {
  test('筛掉不值得通知的', () => {
    const out = buildNotifications(
      [
        item({ id: 'a', newEpisodes: 1 }),
        item({ id: 'b', unwatchedEpisodes: 0, watchedEpisodes: 26 }),
      ],
      {}
    );
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('bilibili:a');
  });

  test('跳过无标题 / 字段缺失的脏数据', () => {
    const out = buildNotifications(
      [
        { source: 'x', id: '1', title: '   ', newEpisodes: 1 },
        { source: 'x', id: '2' } as never,
        null as never,
        { id: '3', newEpisodes: 1 } as never,
      ],
      {}
    );
    expect(out).toHaveLength(0);
  });

  test('items 不是数组 → 返回空', () => {
    expect(buildNotifications(null as never, {})).toEqual([]);
  });

  test('当天已读过的不再打扰（核心防噪音逻辑）', () => {
    const key = buildNotificationKey('bilibili', 'ep1');
    const readMap = { [key]: Date.now() };
    const out = buildNotifications([item({ newEpisodes: 2 })], readMap);
    expect(out).toHaveLength(0);
  });

  test('昨天已读过的今天会重新提醒（有新集就该再提一次）', () => {
    const key = buildNotificationKey('bilibili', 'ep1');
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    const out = buildNotifications([item({ newEpisodes: 2 })], { [key]: yesterday });
    expect(out).toHaveLength(1);
  });

  test('未读的全部返回', () => {
    const out = buildNotifications(
      [item({ id: 'a', newEpisodes: 1 }), item({ id: 'b', unwatchedEpisodes: 2 })],
      {}
    );
    expect(out).toHaveLength(2);
  });

  test('isFollowed 回调参与判定', () => {
    const out = buildNotifications(
      [item({ watchedEpisodes: 0, unwatchedEpisodes: 0 })],
      {},
      () => true
    );
    expect(out).toHaveLength(1);
  });

  test('通知项字段完整（可点击跳转）', () => {
    const [n] = buildNotifications([item({ newEpisodes: 1, unwatchedEpisodes: 2 })], {});
    expect(n.title).toBe('庆余年');
    expect(n.sourceName).toBe('B站');
    expect(n.poster).toBe('https://img/1.jpg');
    expect(n.text).toContain('新增 1 集');
    expect(n.href).toContain('/play?source=');
  });
});

describe('已读记录读写', () => {
  test('空存储 → 空 map', () => {
    expect(readReadMap(makeStorage())).toEqual({});
  });

  test('写后能读回', () => {
    const storage = makeStorage();
    writeReadMap(storage, { 'a:1': 123 });
    expect(readReadMap(storage)).toEqual({ 'a:1': 123 });
  });

  test('脏数据（坏 JSON / 数组 / 非数字值）→ 当没有', () => {
    expect(readReadMap(makeStorage({ [NOTIFICATION_READ_KEY]: 'not json' }))).toEqual({});
    expect(readReadMap(makeStorage({ [NOTIFICATION_READ_KEY]: '[1,2]' }))).toEqual({});
    expect(readReadMap(makeStorage({ [NOTIFICATION_READ_KEY]: '{"a":"x"}' }))).toEqual({});
  });

  test('读取抛错 → 空 map（无痕模式）', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readReadMap(broken)).toEqual({});
  });

  test('写入抛错 → 返回 false 而不是崩', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(writeReadMap(broken, { a: 1 })).toBe(false);
  });

  test('只保留最近 200 条（防无限增长）', () => {
    const storage = makeStorage();
    const big: Record<string, number> = {};
    for (let i = 0; i < 260; i++) big[`k${i}`] = 1000 + i;
    writeReadMap(storage, big);
    const read = readReadMap(storage);
    expect(Object.keys(read).length).toBe(200);
    // 保留的是时间戳最大的（即最新的）
    expect(read['k259']).toBe(1000 + 259);
  });

  test('markAsRead 累加并写回', () => {
    const storage = makeStorage();
    markAsRead(storage, ['a:1', 'b:2'], 5000);
    const read = readReadMap(storage);
    expect(read['a:1']).toBe(5000);
    expect(read['b:2']).toBe(5000);
  });
});

describe('canNotifySystem', () => {
  test('无 Notification 全局时返回 false', () => {
    const orig = (globalThis as any).Notification;
    delete (globalThis as any).Notification;
    expect(canNotifySystem()).toBe(false);
    if (orig) (globalThis as any).Notification = orig;
  });
});
