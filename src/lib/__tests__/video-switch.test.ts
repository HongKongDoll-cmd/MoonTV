import {
  buildVideoCacheKey,
  splitEpisodeCacheKey,
} from '../video-cache';
import {
  resetVideoTrack,
  trackVideoSwitch,
  VIDEO_TRACK_SESSION_KEY,
  videoKeyOfEpisode,
} from '../video-switch';

/** 内存版 Storage，避免依赖 jsdom 的 sessionStorage 残留 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe('trackVideoSwitch', () => {
  test('首次进入不算换片，但会记下来', () => {
    const storage = createMemoryStorage();
    const r = trackVideoSwitch('douban:123', storage);

    expect(r).toEqual({ changed: false, previous: null, current: 'douban:123' });
    expect(storage.getItem(VIDEO_TRACK_SESSION_KEY)).toBe('douban:123');
  });

  test('同一部影片反复进来都不算换片（整页重挂载后依然如此）', () => {
    const storage = createMemoryStorage();
    trackVideoSwitch('douban:123', storage);
    expect(trackVideoSwitch('douban:123', storage).changed).toBe(false);
    expect(trackVideoSwitch('douban:123', storage).changed).toBe(false);
  });

  test('换到另一部影片算换片，并带出上一部', () => {
    const storage = createMemoryStorage();
    trackVideoSwitch('douban:123', storage);
    const r = trackVideoSwitch('douban:456', storage);

    expect(r).toEqual({
      changed: true,
      previous: 'douban:123',
      current: 'douban:456',
    });
  });

  test('换片后记录被更新，不会反复报换片', () => {
    const storage = createMemoryStorage();
    trackVideoSwitch('douban:123', storage);
    expect(trackVideoSwitch('douban:456', storage).changed).toBe(true);
    expect(trackVideoSwitch('douban:456', storage).changed).toBe(false);
  });

  test('同 id 不同源也算换片（换源看同一部片子仍是另一条缓存链）', () => {
    const storage = createMemoryStorage();
    trackVideoSwitch('sourceA:123', storage);
    expect(trackVideoSwitch('sourceB:123', storage).changed).toBe(true);
  });

  test('影片标识为空时不判定、也不写记录（详情还没加载出来）', () => {
    const storage = createMemoryStorage();
    trackVideoSwitch('douban:123', storage);

    const r = trackVideoSwitch('', storage);
    expect(r).toEqual({ changed: false, previous: null, current: '' });
    // 关键：不能把空串写进去，否则下次进来会误判成换片
    expect(storage.getItem(VIDEO_TRACK_SESSION_KEY)).toBe('douban:123');
  });

  test('拿不到 storage 时退化为「不换片」，不抛错', () => {
    expect(trackVideoSwitch('douban:123', null)).toEqual({
      changed: false,
      previous: null,
      current: 'douban:123',
    });
  });

  test('storage 读写抛错时不影响主流程', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(() => trackVideoSwitch('douban:123', broken)).not.toThrow();
    expect(trackVideoSwitch('douban:123', broken).changed).toBe(false);
  });

  test('resetVideoTrack 清空记录后，下一次进来重新变成「首次」', () => {
    const storage = createMemoryStorage();
    trackVideoSwitch('douban:123', storage);
    resetVideoTrack(storage);
    expect(storage.getItem(VIDEO_TRACK_SESSION_KEY)).toBeNull();
    expect(trackVideoSwitch('douban:456', storage).changed).toBe(false);
  });
});

describe('buildVideoCacheKey / videoKeyOfEpisode', () => {
  test('影片标识是 源:id，不含集数', () => {
    expect(buildVideoCacheKey('douban', '123')).toBe('douban:123');
    expect(videoKeyOfEpisode('douban', '123')).toBe('douban:123');
  });
});

describe('splitEpisodeCacheKey', () => {
  test('正常拆分影片标识与集数', () => {
    expect(splitEpisodeCacheKey('douban:123:5')).toEqual({
      videoKey: 'douban:123',
      episode: 5,
    });
  });

  test('影片 id 自带冒号时按最后一个冒号切（不会误判归属）', () => {
    expect(splitEpisodeCacheKey('openlist:media/tv/a:b:0')).toEqual({
      videoKey: 'openlist:media/tv/a:b',
      episode: 0,
    });
  });

  test('集数不是数字时返回 null（不参与清理归属判断）', () => {
    expect(splitEpisodeCacheKey('douban:123:abc')).toBeNull();
    expect(splitEpisodeCacheKey('douban:123:')).toBeNull();
    expect(splitEpisodeCacheKey('douban:123:1.5')).toBeNull();
  });

  test('没有冒号或只有结尾冒号时返回 null', () => {
    expect(splitEpisodeCacheKey('douban123')).toBeNull();
    expect(splitEpisodeCacheKey(':5')).toBeNull();
    expect(splitEpisodeCacheKey('')).toBeNull();
  });

  test('负数集数是合法的（提前解析出的 -1 之类）', () => {
    expect(splitEpisodeCacheKey('douban:123:-1')).toBeNull();
    expect(splitEpisodeCacheKey('douban:123:0')).toEqual({
      videoKey: 'douban:123',
      episode: 0,
    });
  });
});
