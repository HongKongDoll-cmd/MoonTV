import {
  DANMAKU_DENSITY_OPTIONS,
  DANMAKU_DENSITY_PRESETS,
  DANMAKU_DENSITY_STORAGE_KEY,
  DEFAULT_DANMAKU_DENSITY,
  DEFAULT_DANMAKU_THROTTLE,
  densityToThrottleOptions,
  describeDanmakuDensity,
  isDanmakuDensity,
  loadDanmakuDensity,
  saveDanmakuDensity,
  throttleDanmaku,
} from '../danmaku-throttle';

describe('弹幕密度档位', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('默认档位必须与既有默认限流参数一致（不能悄悄改变老用户的观感）', () => {
    expect(DEFAULT_DANMAKU_DENSITY).toBe('standard');
    expect(DANMAKU_DENSITY_PRESETS.standard).toEqual({
      maxPerSecond: DEFAULT_DANMAKU_THROTTLE.maxPerSecond,
      maxTotal: DEFAULT_DANMAKU_THROTTLE.maxTotal,
    });
  });

  test('三档阈值严格递增', () => {
    const { sparse, standard, dense } = DANMAKU_DENSITY_PRESETS;
    expect(sparse.maxPerSecond).toBeLessThan(standard.maxPerSecond);
    expect(standard.maxPerSecond).toBeLessThan(dense.maxPerSecond);
    expect(sparse.maxTotal).toBeLessThan(standard.maxTotal);
    expect(standard.maxTotal).toBeLessThan(dense.maxTotal);
  });

  test('选项列表与预设一一对应（漏一档就渲染不出来）', () => {
    const values = DANMAKU_DENSITY_OPTIONS.map((o) => o.value).sort();
    expect(values).toEqual(Object.keys(DANMAKU_DENSITY_PRESETS).sort());
  });

  test('未设置时读默认档', () => {
    expect(loadDanmakuDensity()).toBe(DEFAULT_DANMAKU_DENSITY);
  });

  test('save / load 往返', () => {
    saveDanmakuDensity('dense');
    expect(loadDanmakuDensity()).toBe('dense');
    expect(window.localStorage.getItem(DANMAKU_DENSITY_STORAGE_KEY)).toBe(
      'dense'
    );
  });

  test('存储里是脏值时回退默认档（不能因此抛错或把弹幕抽成 0 条）', () => {
    window.localStorage.setItem(DANMAKU_DENSITY_STORAGE_KEY, '{"bad":1}');
    expect(loadDanmakuDensity()).toBe(DEFAULT_DANMAKU_DENSITY);

    window.localStorage.setItem(DANMAKU_DENSITY_STORAGE_KEY, 'super-dense');
    expect(loadDanmakuDensity()).toBe(DEFAULT_DANMAKU_DENSITY);
  });

  test('isDanmakuDensity 只认三个值', () => {
    expect(isDanmakuDensity('sparse')).toBe(true);
    expect(isDanmakuDensity('standard')).toBe(true);
    expect(isDanmakuDensity('dense')).toBe(true);
    expect(isDanmakuDensity('DENSE')).toBe(false);
    expect(isDanmakuDensity(null)).toBe(false);
    expect(isDanmakuDensity(3)).toBe(false);
  });

  test('densityToThrottleOptions 对非法输入回退默认档', () => {
    expect(densityToThrottleOptions('nope')).toEqual(
      DANMAKU_DENSITY_PRESETS.standard
    );
    expect(densityToThrottleOptions(null)).toEqual(
      DANMAKU_DENSITY_PRESETS.standard
    );
    expect(densityToThrottleOptions(undefined)).toEqual(
      DANMAKU_DENSITY_PRESETS.standard
    );
  });

  test('实际抽稀效果：密集 > 标准 > 稀疏', () => {
    // 每条 1 秒内塞 30 条，共 40 秒 = 1200 条
    const list = Array.from({ length: 1200 }, (_, i) => ({
      time: Math.floor(i / 30),
      text: `d${i}`,
    }));

    const sparse = throttleDanmaku(list, densityToThrottleOptions('sparse'));
    const standard = throttleDanmaku(
      list,
      densityToThrottleOptions('standard')
    );
    const dense = throttleDanmaku(list, densityToThrottleOptions('dense'));

    expect(sparse.length).toBeLessThan(standard.length);
    expect(standard.length).toBeLessThan(dense.length);
    // 稀疏档单集上限 300 必须被尊重
    expect(sparse.length).toBeLessThanOrEqual(
      DANMAKU_DENSITY_PRESETS.sparse.maxTotal
    );
    // 密集档每秒 20 条 × 40 秒 = 800，未触及 1500 上限
    expect(dense.length).toBe(800);
  });

  test('抽稀后仍保持时序（弹幕必须按时间升序）', () => {
    const list = Array.from({ length: 900 }, (_, i) => ({
      time: Math.floor(i / 30),
      text: `d${i}`,
    }));
    const out = throttleDanmaku(list, densityToThrottleOptions('sparse'));
    for (let i = 1; i < out.length; i++) {
      expect(out[i].time).toBeGreaterThanOrEqual(out[i - 1].time);
    }
  });

  test('describeDanmakuDensity 返回中文档位名', () => {
    expect(describeDanmakuDensity('sparse')).toBe('稀疏');
    expect(describeDanmakuDensity('standard')).toBe('标准');
    expect(describeDanmakuDensity('dense')).toBe('密集');
  });
});
