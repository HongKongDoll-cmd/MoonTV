import {
  buildSubtitleTracks,
  detectSubtitleLang,
  extractEpisodeKey,
  guessSubtitleType,
  isSubtitleFile,
  pickSubtitleTrack,
  stripSubtitleExtension,
  SUBTITLE_FONT_SIZES,
  SUBTITLE_STYLE_PRESETS,
  toSubtitleStyleObject,
} from '../subtitle';

describe('isSubtitleFile / guessSubtitleType / stripSubtitleExtension', () => {
  test('识别常见字幕扩展名（含大写）', () => {
    expect(isSubtitleFile('E01.srt')).toBe(true);
    expect(isSubtitleFile('E01.ASS')).toBe(true);
    expect(isSubtitleFile('E01.zh.ssa')).toBe(true);
    expect(isSubtitleFile('E01.vtt')).toBe(true);
    expect(isSubtitleFile('E01.smi')).toBe(true);
  });

  test('视频与其它文件不算字幕', () => {
    expect(isSubtitleFile('E01.mkv')).toBe(false);
    expect(isSubtitleFile('poster.jpg')).toBe(false);
    expect(isSubtitleFile('subtitles')).toBe(false);
    expect(isSubtitleFile('')).toBe(false);
  });

  test('类型推断', () => {
    expect(guessSubtitleType('a.srt')).toBe('srt');
    expect(guessSubtitleType('a.ass')).toBe('ass');
    expect(guessSubtitleType('a.ssa')).toBe('ass');
    expect(guessSubtitleType('a.vtt')).toBe('vtt');
    // .sub / .smi 交给 srt 解析器
    expect(guessSubtitleType('a.sub')).toBe('srt');
  });

  test('去扩展名只去最后一层', () => {
    expect(stripSubtitleExtension('E01.zh.srt')).toBe('E01.zh');
    expect(stripSubtitleExtension('E01.mkv')).toBe('E01.mkv');
  });
});

describe('extractEpisodeKey', () => {
  test('S01E01 各种写法', () => {
    expect(extractEpisodeKey('S01E01.mkv')).toBe('s01e01');
    expect(extractEpisodeKey('s1e1.srt')).toBe('s01e01');
    expect(extractEpisodeKey('Special Ops_ Lioness_S01E02_xxx.srt')).toBe('s01e02');
    expect(extractEpisodeKey('Show.S03.E12.srt')).toBe('s03e12');
  });

  test('第 X 集', () => {
    expect(extractEpisodeKey('第01集.mkv')).toBe('c01');
    expect(extractEpisodeKey('漫长的季节 第 12 集.srt')).toBe('c12');
    expect(extractEpisodeKey('第5话.srt')).toBe('c05');
  });

  test('单独 E01 / EP01', () => {
    expect(extractEpisodeKey('E01.mkv')).toBe('e01');
    expect(extractEpisodeKey('Show EP05.srt')).toBe('e05');
    expect(extractEpisodeKey('Show - episode 8.srt')).toBe('e08');
  });

  test('认不出时返回空串', () => {
    expect(extractEpisodeKey('随便一个文件名.mkv')).toBe('');
    expect(extractEpisodeKey('')).toBe('');
  });

  test('不会把标题里的字母误判成集号', () => {
    // "Movie E" 结尾没有数字，不该当成 E 集
    expect(extractEpisodeKey('The Movie E.mkv')).toBe('');
  });
});

describe('detectSubtitleLang', () => {
  test('简中 / 繁中 / 英文', () => {
    expect(detectSubtitleLang('E01.zh.srt')).toBe('zh-Hans');
    expect(detectSubtitleLang('E01.简中.srt')).toBe('zh-Hans');
    expect(detectSubtitleLang('E01.chs.srt')).toBe('zh-Hans');
    expect(detectSubtitleLang('E01.繁中.srt')).toBe('zh-Hant');
    expect(detectSubtitleLang('E01.cht.srt')).toBe('zh-Hant');
    expect(detectSubtitleLang('E01.eng.srt')).toBe('en');
    expect(detectSubtitleLang('E01.英文.srt')).toBe('en');
  });

  test('繁体标记优先于简体（同时出现时以繁为准）', () => {
    expect(detectSubtitleLang('E01.中文.繁体.srt')).toBe('zh-Hant');
  });

  test('未标注返回 unknown', () => {
    expect(detectSubtitleLang('E01.srt')).toBe('unknown');
  });
});

describe('buildSubtitleTracks', () => {
  test('生成字幕轨并带上语言标签', () => {
    const tracks = buildSubtitleTracks([
      { name: 'E01.zh.srt', url: '/s/E01.zh.srt' },
      { name: 'E01.en.srt', url: '/s/E01.en.srt' },
      { name: 'E01.mkv', url: '/s/E01.mkv' },
    ]);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].name).toContain('[简体]');
    expect(tracks[0].type).toBe('srt');
    expect(tracks[1].lang).toBe('en');
  });

  test('同名字幕不会撞名', () => {
    const tracks = buildSubtitleTracks([
      { name: 'movie.srt', url: '/a' },
      { name: 'movie.srt', url: '/b' },
    ]);
    expect(tracks[0].name).not.toBe(tracks[1].name);
  });

  test('脏数据被丢弃', () => {
    const tracks = buildSubtitleTracks([
      { name: '', url: '/a' },
      { name: 'x.srt', url: '' },
      { name: 'x.txt', url: '/c' },
    ]);
    expect(tracks).toHaveLength(0);
  });
});

describe('pickSubtitleTrack', () => {
  const tracks = buildSubtitleTracks([
    { name: 'E01.zh.srt', url: '/s/E01.zh.srt' },
    { name: 'E01.en.srt', url: '/s/E01.en.srt' },
    { name: 'E02.zh.srt', url: '/s/E02.zh.srt' },
  ]);

  test('按集数精确匹配', () => {
    expect(pickSubtitleTrack('E02.mkv', tracks)?.url).toBe('/s/E02.zh.srt');
    expect(pickSubtitleTrack('E01.mkv', tracks)?.url).toBe('/s/E01.zh.srt');
  });

  test('同集数多语言时优先简体', () => {
    const picked = pickSubtitleTrack('E01.mkv', tracks);
    expect(picked?.lang).toBe('zh-Hans');
  });

  test('没有对应集数时返回 null（不乱配）', () => {
    expect(pickSubtitleTrack('E99.mkv', tracks)).toBeNull();
  });

  test('只有一条字幕且视频认不出集数时直接用', () => {
    const single = buildSubtitleTracks([{ name: '整季字幕.srt', url: '/s/one.srt' }]);
    expect(pickSubtitleTrack('随机名字.mkv', single)?.url).toBe('/s/one.srt');
  });

  test('空列表返回 null', () => {
    expect(pickSubtitleTrack('E01.mkv', [])).toBeNull();
  });
});

describe('字幕样式预设', () => {
  test('三档预设的字号递增', () => {
    const sizes = SUBTITLE_STYLE_PRESETS.map((p) => p.fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  test('字号档位非空且为正', () => {
    expect(SUBTITLE_FONT_SIZES.length).toBeGreaterThan(0);
    for (const size of SUBTITLE_FONT_SIZES) expect(size).toBeGreaterThan(0);
  });

  test('转成 ArtPlayer style 对象（带 px / % 单位）', () => {
    const style = toSubtitleStyleObject(SUBTITLE_STYLE_PRESETS[1]); // 中
    expect(style.fontSize).toBe('30px');
    expect(style.bottom).toBe('8%');
    expect(style.color).toBe('#ffffff');
  });
});
