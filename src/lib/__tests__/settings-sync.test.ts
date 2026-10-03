import {
  applySettingsToStorage,
  collectSyncableSettings,
  findLocalKey,
  isKnownCloudKey,
  isValidValue,
  mergeSettings,
  NON_SYNCABLE_REASONS,
  SYNCABLE_SETTINGS,
  syncSettings,
} from '../settings-sync';

/** 造一个可控的 Storage 替身 */
function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    _map: map,
  };
}

describe('SYNCABLE_SETTINGS 白名单', () => {
  test('不含任何数据类 key（收藏/播放记录/追更）', () => {
    const keys = Object.keys(SYNCABLE_SETTINGS);
    for (const forbidden of [
      'moontv_favorites',
      'moontv_play_records',
      'moontv_followings',
      'moontv_search_history',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test('不含运行期/临时 key', () => {
    const keys = Object.keys(SYNCABLE_SETTINGS);
    for (const forbidden of ['imgFallbackStep', 'imgFallbackFor', 'test:1', 'downloadTasks']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test('每个排除项都写明了原因（便于后人理解）', () => {
    for (const key of Object.keys(NON_SYNCABLE_REASONS)) {
      expect(NON_SYNCABLE_REASONS[key].length).toBeGreaterThan(4);
    }
  });

  test('云端键不重复', () => {
    const clouds = Object.values(SYNCABLE_SETTINGS);
    expect(new Set(clouds).size).toBe(clouds.length);
  });
});

describe('isValidValue', () => {
  test('正常值通过', () => {
    expect(isValidValue('list')).toBe(true);
    expect(isValidValue('{"a":1}')).toBe(true);
    expect(isValidValue('0')).toBe(true);
  });

  test('空串被拒（清空不应同步，否则会刷所有设备）', () => {
    expect(isValidValue('')).toBe(false);
  });

  test('非字符串被拒', () => {
    expect(isValidValue(null)).toBe(false);
    expect(isValidValue(undefined)).toBe(false);
  });

  test('超长值被拒（脏数据）', () => {
    expect(isValidValue('x'.repeat(64 * 1024 + 1))).toBe(false);
  });
});

describe('collectSyncableSettings', () => {
  test('只收集白名单内的项，且换成云端键名', () => {
    const storage = makeStorage({
      moontv_library_view: 'grid',
      moontv_theme_palette: 'ocean',
      moontv_favorites: '[{"title":"x"}]', // 不该被收集
    });
    const out = collectSyncableSettings(storage);
    expect(out).toEqual({ libraryView: 'grid', themePalette: 'ocean' });
    expect(out).not.toHaveProperty('moontv_favorites');
  });

  test('存储读取抛错时返回空对象（无痕模式）', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(collectSyncableSettings(broken)).toEqual({});
  });

  test('空值项被跳过', () => {
    const storage = makeStorage({ moontv_library_view: '', moontv_theme_palette: 'dark' });
    const out = collectSyncableSettings(storage);
    expect(out).not.toHaveProperty('libraryView');
    expect(out.themePalette).toBe('dark');
  });
});

describe('mergeSettings', () => {
  test('远端较新 → 覆盖本地', () => {
    const { merged, changed } = mergeSettings(
      { libraryView: 'list' },
      [{ key: 'libraryView', value: 'grid', updatedAt: 2000 }],
      1000
    );
    expect(merged.libraryView).toBe('grid');
    expect(changed).toContain('libraryView');
  });

  test('远端较旧 → 保留本地', () => {
    const { merged, changed } = mergeSettings(
      { libraryView: 'grid' },
      [{ key: 'libraryView', value: 'list', updatedAt: 1000 }],
      2000
    );
    expect(merged.libraryView).toBe('grid');
    expect(changed).toHaveLength(0);
  });

  test('无时间戳的远端项（老客户端上传）→ 无条件采用', () => {
    const { merged } = mergeSettings(
      { libraryView: 'grid' },
      [{ key: 'libraryView', value: 'list', updatedAt: 0 }],
      9999
    );
    expect(merged.libraryView).toBe('list');
  });

  test('远端出现未知键 → 忽略（防手工构造塞脏数据）', () => {
    const { merged, changed } = mergeSettings({}, [
      { key: 'evil_key', value: 'x', updatedAt: 2000 },
    ]);
    expect(merged.evil_key).toBeUndefined();
    expect(changed).toHaveLength(0);
  });

  test('远端值为空串 → 忽略', () => {
    const { merged } = mergeSettings({ libraryView: 'grid' }, [
      { key: 'libraryView', value: '', updatedAt: 2000 },
    ]);
    expect(merged.libraryView).toBe('grid');
  });

  test('值为相同的项不进 changed', () => {
    const { changed } = mergeSettings({ libraryView: 'grid' }, [
      { key: 'libraryView', value: 'grid', updatedAt: 2000 },
    ]);
    expect(changed).toHaveLength(0);
  });

  test('远端为 null/空 → 只返回本地', () => {
    expect(mergeSettings({ a: '1' }, null).merged).toEqual({ a: '1' });
    expect(mergeSettings({ a: '1' }, []).merged).toEqual({ a: '1' });
  });

  test('远端含 null 项 / 非字符串 value → 不崩且跳过', () => {
    const { merged } = mergeSettings({}, [
      null as never,
      { key: 'libraryView', value: 123 as never, updatedAt: 2000 },
    ]);
    expect(merged).toEqual({});
  });
});

describe('isKnownCloudKey / findLocalKey', () => {
  test('双向可查', () => {
    expect(isKnownCloudKey('libraryView')).toBe(true);
    expect(isKnownCloudKey('nope')).toBe(false);
    expect(findLocalKey('libraryView')).toBe('moontv_library_view');
    expect(findLocalKey('nope')).toBeNull();
  });
});

describe('applySettingsToStorage', () => {
  test('云端键写回对应的本地键', () => {
    const storage = makeStorage();
    const written = applySettingsToStorage(storage, {
      libraryView: 'grid',
      themePalette: 'ocean',
    });
    expect(storage._map.get('moontv_library_view')).toBe('grid');
    expect(storage._map.get('moontv_theme_palette')).toBe('ocean');
    expect(written.sort()).toEqual(['moontv_library_view', 'moontv_theme_palette']);
  });

  test('未知键不写', () => {
    const storage = makeStorage();
    applySettingsToStorage(storage, { nope: 'x' });
    expect(storage._map.size).toBe(0);
  });

  test('写入抛错时跳过（无痕模式）', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(applySettingsToStorage(storage, { libraryView: 'grid' })).toEqual([]);
  });
});

describe('syncSettings 完整流程', () => {
  test('拉取云端 → 合并 → 写回本地，并报告需上传的项', () => {
    const storage = makeStorage({
      moontv_library_view: 'list',
      moontv_theme_palette: 'local-theme',
    });
    const { changed, uploaded } = syncSettings({
      storage,
      remote: [
        { key: 'libraryView', value: 'grid', updatedAt: 2000 },
        { key: 'sidenavCollapsed', value: 'true', updatedAt: 2000 },
      ],
      localUpdatedAt: 1000,
    });

    // 云端两项都写回了本地
    expect(storage._map.get('moontv_library_view')).toBe('grid');
    expect(storage._map.get('moontv_sidenav_collapsed')).toBe('true');
    expect(changed.sort()).toEqual(['libraryView', 'sidenavCollapsed']);
    // 本地独有的 themePalette 需要上传
    expect(uploaded.themePalette).toBe('local-theme');
    expect(uploaded).not.toHaveProperty('libraryView');
  });

  test('云端为空 → 不动本地，只报告全部待上传', () => {
    const storage = makeStorage({ moontv_library_view: 'list' });
    const { changed, uploaded } = syncSettings({ storage, remote: [] });
    expect(changed).toHaveLength(0);
    expect(uploaded).toEqual({ libraryView: 'list' });
    expect(storage._map.get('moontv_library_view')).toBe('list');
  });

  test('本地为空 → 云端全量落地', () => {
    const storage = makeStorage();
    syncSettings({
      storage,
      remote: [{ key: 'themePalette', value: 'ocean', updatedAt: 2000 }],
    });
    expect(storage._map.get('moontv_theme_palette')).toBe('ocean');
  });
});
