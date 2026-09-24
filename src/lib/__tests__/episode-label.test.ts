import {
  formatEpisodeBadge,
  looksLikeFileTitle,
  resolveEpisodeButtonText,
} from '../episode-label';

describe('looksLikeFileTitle', () => {
  test('视频扩展名命中', () => {
    expect(looksLikeFileTitle('Special Ops_ Lioness_S01E01_Sacrificial Soldiers.mkv')).toBe(true);
    expect(looksLikeFileTitle('第01集.mp4')).toBe(true);
    expect(looksLikeFileTitle('E02.MKV')).toBe(true);
    expect(looksLikeFileTitle('movie.webm')).toBe(true);
  });

  test('相对路径命中（影库目录摊平）', () => {
    expect(looksLikeFileTitle('Season 1/E02.mkv')).toBe(true);
    expect(looksLikeFileTitle('第一季/第01集.mp4')).toBe(true);
  });

  test('SxxExx 开头命中', () => {
    expect(looksLikeFileTitle('S01E01 - Pilot')).toBe(true);
    expect(looksLikeFileTitle('s2e10 标题')).toBe(true);
  });

  test('普通集名不命中', () => {
    expect(looksLikeFileTitle('第3集')).toBe(false);
    expect(looksLikeFileTitle('3')).toBe(false);
    expect(looksLikeFileTitle('预告片')).toBe(false);
    expect(looksLikeFileTitle('漫长的季节')).toBe(false);
    expect(looksLikeFileTitle('')).toBe(false);
    expect(looksLikeFileTitle('   ')).toBe(false);
  });

  test('扩展名大小写与边界', () => {
    expect(looksLikeFileTitle('a.Mp4')).toBe(true);
    // .mp4xx 不是扩展名结尾
    expect(looksLikeFileTitle('a.mp4xx')).toBe(false);
    // 扩展名必须结尾
    expect(looksLikeFileTitle('a.mkv.backup')).toBe(false);
  });
});

describe('formatEpisodeBadge', () => {
  test('两位补零（≤99 集）', () => {
    expect(formatEpisodeBadge(1, 24)).toBe('E01');
    expect(formatEpisodeBadge(9, 24)).toBe('E09');
    expect(formatEpisodeBadge(24, 24)).toBe('E24');
  });

  test('三位补零（100~999 集）', () => {
    expect(formatEpisodeBadge(1, 120)).toBe('E001');
    expect(formatEpisodeBadge(99, 120)).toBe('E099');
    expect(formatEpisodeBadge(120, 120)).toBe('E120');
  });

  test('四位补零（≥1000 集）', () => {
    expect(formatEpisodeBadge(1, 1500)).toBe('E0001');
  });

  test('不合法输入不崩溃', () => {
    expect(formatEpisodeBadge(0, 10)).toBe('E00');
    // 负数不该走到这里（集号 1 起算），但即便传入也只产出字符串不抛错
    expect(() => formatEpisodeBadge(-3, 10)).not.toThrow();
  });
});

describe('resolveEpisodeButtonText', () => {
  test('无标题 → 纯集号', () => {
    expect(resolveEpisodeButtonText(undefined, 3, 20)).toBe('3');
    expect(resolveEpisodeButtonText('', 3, 20)).toBe('3');
    expect(resolveEpisodeButtonText('   ', 3, 20)).toBe('3');
  });

  test('「第X集」→ 只留数字（原行为不变）', () => {
    expect(resolveEpisodeButtonText('第12集', 12, 40)).toBe('12');
    expect(resolveEpisodeButtonText('【国语】第3集', 3, 40)).toBe('3');
  });

  test('文件名式标题 → E 短标签（优先于「第X集」折叠）', () => {
    expect(
      resolveEpisodeButtonText(
        'Special Ops_ Lioness_S01E01_Sacrificial Soldiers.mkv',
        1,
        8
      )
    ).toBe('E01');
    expect(resolveEpisodeButtonText('第一季/E10.mkv', 10, 24)).toBe('E10');
    expect(resolveEpisodeButtonText('S01E01 - Pilot', 1, 8)).toBe('E01');
    // 网盘常见「第005集.mkv」：按文件名统一折叠成 E005，保持整列格式一致
    expect(resolveEpisodeButtonText('第005集.mkv', 5, 150)).toBe('E005');
  });

  test('文件名式标题按总集数决定位宽', () => {
    expect(resolveEpisodeButtonText('E02.mp4', 2, 150)).toBe('E002');
  });

  test('普通集名原样显示（原行为不变）', () => {
    expect(resolveEpisodeButtonText('预告片', 5, 20)).toBe('预告片');
    expect(resolveEpisodeButtonText('漫长的季节', 1, 12)).toBe('漫长的季节');
  });
});
