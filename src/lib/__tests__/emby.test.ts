import {
  buildEmbyImageUrl,
  buildEmbySearchParams,
  buildEmbyStreamUrl,
  EMBY_SOURCE,
  EMBY_SOURCE_NAME,
  isEmbyMovie,
  isEmbySeries,
  mapEmbyDetailToResult,
  mapEmbyItemsToSearchResults,
  mapEmbyLibraries,
  mapEmbyUsers,
  mergeEmbyItems,
  resolveEmbyLibraryIds,
} from '@/lib/emby';

const movie = {
  Id: 'm1',
  Name: '流浪地球 2',
  Type: 'Movie',
  ProductionYear: 2023,
  Overview: '简介',
  MediaSources: [{ Id: 'ms1', Container: 'mkv' }],
};

const series = {
  Id: 's1',
  Name: '漫长的季节',
  Type: 'Series',
  ProductionYear: 2023,
};

const episodes = [
  { Id: 'e1', Name: '第一集', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, MediaSources: [{ Id: 'mse1' }] },
  { Id: 'e2', Name: '第二集', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2 },
];

describe('Emby 条目类型判断', () => {
  it('认得电影与剧集', () => {
    expect(isEmbyMovie(movie)).toBe(true);
    expect(isEmbyMovie(series)).toBe(false);
    expect(isEmbySeries(series)).toBe(true);
    expect(isEmbySeries(movie)).toBe(false);
  });

  it('Episode 既不是电影也不是剧集（只在详情展开里出现）', () => {
    expect(isEmbyMovie(episodes[0])).toBe(false);
    expect(isEmbySeries(episodes[0])).toBe(false);
  });
});

describe('Emby 搜索结果映射', () => {
  it('非数组输入返回空', () => {
    expect(mapEmbyItemsToSearchResults(null)).toEqual([]);
    expect(mapEmbyItemsToSearchResults('x')).toEqual([]);
  });

  it('电影映射为单集影片，剧集映射为剧集（空集数）', () => {
    const results = mapEmbyItemsToSearchResults([movie, series]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: 'm1',
      title: '流浪地球 2',
      source: EMBY_SOURCE,
      source_name: EMBY_SOURCE_NAME,
      class: '影片',
      year: '2023',
    });
    expect(results[0].episodes).toEqual(['']);
    expect(results[1]).toMatchObject({
      id: 's1',
      title: '漫长的季节',
      class: '剧集',
    });
    expect(results[1].episodes).toEqual([]);
  });

  it('海报走同源代理（不直连影库）', () => {
    const results = mapEmbyItemsToSearchResults([movie]);
    expect(results[0].poster).toBe('/api/library-image?e=m1');
  });

  it('缺 Id / Name 或非影片类型的条目被丢弃', () => {
    const results = mapEmbyItemsToSearchResults([
      { Id: 'x1', Name: '音乐', Type: 'MusicAlbum' },
      { Id: '', Name: '无ID', Type: 'Movie' },
      { Name: '无条目', Type: 'Movie' },
      null,
    ]);
    expect(results).toEqual([]);
  });
});

describe('Emby 播放直链', () => {
  it('带 api_key 与 static 参数；mediaSourceId 不同于条目时一并下发', () => {
    const url = buildEmbyStreamUrl('https://emby.example.com', 'm1', 'KEY', 'ms1');
    expect(url).toContain('https://emby.example.com/Videos/m1/stream?');
    expect(url).toContain('static=true');
    expect(url).toContain('api_key=KEY');
    expect(url).toContain('mediaSourceId=ms1');
  });

  it('mediaSourceId 与条目相同时不重复下发', () => {
    const url = buildEmbyStreamUrl('https://emby.example.com', 'm1', 'KEY', 'm1');
    expect(url).not.toContain('mediaSourceId');
  });

  it('缺地址 / 条目 / key 时返回空串', () => {
    expect(buildEmbyStreamUrl('', 'm1', 'KEY')).toBe('');
    expect(buildEmbyStreamUrl('https://e.com', '', 'KEY')).toBe('');
    expect(buildEmbyStreamUrl('https://e.com', 'm1', '')).toBe('');
  });

  it('地址缺协议时补 https，尾斜杠被去掉', () => {
    const url = buildEmbyStreamUrl('emby.example.com/', 'm1', 'KEY');
    expect(url.startsWith('https://emby.example.com/Videos/m1/stream?')).toBe(true);
  });
});

describe('Emby 详情映射', () => {
  const config = { baseUrl: 'https://emby.example.com', token: 'KEY' };

  it('电影 → 单集直链', () => {
    const result = mapEmbyDetailToResult(movie, null, config);
    expect(result).not.toBeNull();
    expect(result?.episodes).toHaveLength(1);
    expect(result?.episodes[0]).toContain('/Videos/m1/stream?');
    expect(result?.episodes_titles).toEqual(['流浪地球 2']);
    expect(result?.poster).toBe(buildEmbyImageUrl('m1'));
  });

  it('剧集 → 展开 Episode 列表，标题带 S/E 编号', () => {
    const result = mapEmbyDetailToResult(series, episodes, config);
    expect(result?.episodes).toHaveLength(2);
    expect(result?.episodes_titles[0]).toContain('S1E1');
    expect(result?.episodes_titles[1]).toContain('S1E2');
    // 第一集的 mediaSourceId 取自 MediaSources
    expect(result?.episodes[0]).toContain('mediaSourceId=mse1');
    expect(result?.episodes[1]).not.toContain('mediaSourceId');
  });

  it('剧集的详情标题用剧集名', () => {
    const result = mapEmbyDetailToResult(
      series,
      episodes,
      config
    );
    expect(result?.title).toBe('漫长的季节');
  });

  it('没有可播放集数时返回 null（404 语义）', () => {
    expect(mapEmbyDetailToResult(series, [], config)).toBeNull();
    expect(
      mapEmbyDetailToResult({ Id: 'x', Name: 'x', Type: 'Series' }, null, config)
    ).toBeNull();
  });
});

describe('Emby 搜索参数', () => {
  it('只搜电影与剧集，带年份与简介字段', () => {
    const params = buildEmbySearchParams('沙丘');
    expect(params).toMatchObject({
      searchTerm: '沙丘',
      IncludeItemTypes: 'Movie,Series',
      Recursive: 'true',
      Fields: 'ProductionYear,Overview',
    });
    expect(params.Limit).toBe('24');
  });
});

describe('Emby 用户列表映射', () => {
  it('保留正常用户', () => {
    expect(
      mapEmbyUsers([
        { Id: 'u1', Name: 'homeuser' },
        { Id: 'u2', Name: 'kid' },
      ])
    ).toEqual([
      { Id: 'u1', Name: 'homeuser' },
      { Id: 'u2', Name: 'kid' },
    ]);
  });

  it('跳过隐藏 / 禁用用户', () => {
    expect(
      mapEmbyUsers([
        { Id: 'u1', Name: 'a', Configuration: { IsHidden: true } },
        { Id: 'u2', Name: 'b', Policy: { IsDisabled: true } },
        { Id: 'u3', Name: 'c' },
      ])
    ).toEqual([{ Id: 'u3', Name: 'c' }]);
  });

  it('没有名字的用户退回 Id，不至于在下拉里出现空行', () => {
    expect(mapEmbyUsers([{ Id: 'u9' }])).toEqual([{ Id: 'u9', Name: 'u9' }]);
  });

  it('非数组与脏数据返回空列表', () => {
    expect(mapEmbyUsers(null)).toEqual([]);
    expect(mapEmbyUsers([null, 1, 'x', {}])).toEqual([]);
  });
});

describe('Emby 媒体库映射', () => {
  it('从 Views 响应外壳里取 Items', () => {
    expect(
      mapEmbyLibraries({
        Items: [
          { Id: 'lib-1', Name: '电影', CollectionType: 'movies' },
          { Id: 'lib-2', Name: '剧集', CollectionType: 'tvshows' },
        ],
      })
    ).toEqual([
      { Id: 'lib-1', Name: '电影', CollectionType: 'movies' },
      { Id: 'lib-2', Name: '剧集', CollectionType: 'tvshows' },
    ]);
  });

  it('也接受裸数组（部分 Jellyfin 版本直接返回数组）', () => {
    expect(mapEmbyLibraries([{ Id: 'l1', Name: '音乐' }])).toEqual([
      { Id: 'l1', Name: '音乐', CollectionType: undefined },
    ]);
  });

  it('缺 Id 或 Name 的视图丢弃', () => {
    expect(
      mapEmbyLibraries({ Items: [{ Name: '没 ID' }, { Id: 'x' }, null] })
    ).toEqual([]);
  });

  it('非对象与空响应返回空列表', () => {
    expect(mapEmbyLibraries(null)).toEqual([]);
    expect(mapEmbyLibraries({})).toEqual([]);
    expect(mapEmbyLibraries('x')).toEqual([]);
  });
});

describe('Emby 已选媒体库校验', () => {
  const libraries = [
    { Id: 'lib-1', Name: '电影' },
    { Id: 'lib-2', Name: '剧集' },
  ];

  it('只保留影库里还存在的 ID', () => {
    expect(resolveEmbyLibraryIds(['lib-1', 'lib-gone'], libraries)).toEqual([
      'lib-1',
    ]);
  });

  it('去重', () => {
    expect(resolveEmbyLibraryIds(['lib-1', 'lib-1'], libraries)).toEqual([
      'lib-1',
    ]);
  });

  it('全都不存在时返回空数组（= 全部库，不是搜不到）', () => {
    expect(resolveEmbyLibraryIds(['nope'], libraries)).toEqual([]);
  });

  it('库列表为空时不瞎校验（还没拉取就别把配置清掉）', () => {
    expect(resolveEmbyLibraryIds(['lib-1'], [])).toEqual([]);
  });

  it('非数组一律当「全部库」', () => {
    expect(resolveEmbyLibraryIds(null, libraries)).toEqual([]);
    expect(resolveEmbyLibraryIds('lib-1', libraries)).toEqual([]);
  });
});

describe('Emby 分库搜索结果合并', () => {
  const a = { Id: 'm1', Name: 'A' };
  const b = { Id: 'm2', Name: 'B' };

  it('同一部片子挂在多个库时只出现一次', () => {
    expect(mergeEmbyItems([[a, b], [a]])).toEqual([a, b]);
  });

  it('截断到 limit', () => {
    const many = [
      { Id: 'x1' },
      { Id: 'x2' },
      { Id: 'x3' },
    ];
    expect(mergeEmbyItems([many], 2)).toHaveLength(2);
  });

  it('没有 Id 的条目丢掉（无法去重也无法播放）', () => {
    expect(mergeEmbyItems([[{ Name: '无 ID' }, a]])).toEqual([a]);
  });

  it('空批次返回空数组', () => {
    expect(mergeEmbyItems([], 10)).toEqual([]);
    expect(mergeEmbyItems([null, 'x'], 10)).toEqual([]);
  });
});
