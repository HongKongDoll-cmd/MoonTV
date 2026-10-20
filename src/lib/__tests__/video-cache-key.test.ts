import { describeEpisodeCacheKey } from '../video-cache';

describe('describeEpisodeCacheKey（4.6.3 缓存面板可读性）', () => {
  test('普通 key 拆出源、id、集数', () => {
    const out = describeEpisodeCacheKey('openlist:/d/abc/def.mp4:2');
    expect(out).toEqual({
      source: 'openlist',
      sourceName: '网盘',
      id: '/d/abc/def.mp4',
      episodeIndex: 2,
      isSeries: true,
    });
  });

  test('已知来源映射成中文名，未知来源用原代号', () => {
    expect(describeEpisodeCacheKey('emby:12345:0').sourceName).toBe('影库');
    expect(describeEpisodeCacheKey('索尼:999:0').sourceName).toBe('索尼');
  });

  test('电影（集数 0）isSeries 为 false', () => {
    const out = describeEpisodeCacheKey('openlist:/d/movie.mkv:0');
    expect(out.isSeries).toBe(false);
    expect(out.episodeIndex).toBe(0);
  });

  test('id 是带端口的主机名也不会被切坏', () => {
    // key = `openlist:http://192.168.1.5:5244/d/xxx.mp4:1`
    const out = describeEpisodeCacheKey('openlist:http://192.168.1.5:5244/d/xxx.mp4:1');
    expect(out.source).toBe('openlist');
    expect(out.id).toBe('http://192.168.1.5:5244/d/xxx.mp4');
    expect(out.episodeIndex).toBe(1);
  });

  test('集数不是数字时整串当 id（不崩）', () => {
    const out = describeEpisodeCacheKey('openlist:/d/a.mp4:abc');
    expect(out.sourceName).toBe('未知来源');
    expect(out.id).toBe('openlist:/d/a.mp4:abc');
    expect(out.isSeries).toBe(false);
  });

  test('段数不足时整串当 id', () => {
    expect(describeEpisodeCacheKey('openlist').id).toBe('openlist');
    expect(describeEpisodeCacheKey('openlist:/d/a.mp4').id).toBe(
      'openlist:/d/a.mp4'
    );
  });

  test('空串安全返回', () => {
    const out = describeEpisodeCacheKey('');
    expect(out.id).toBe('');
    expect(out.source).toBe('');
    expect(out.isSeries).toBe(false);
  });

  test('不修改入参', () => {
    const key = 'openlist:/d/a.mp4:3';
    describeEpisodeCacheKey(key);
    expect(key).toBe('openlist:/d/a.mp4:3');
  });
});
