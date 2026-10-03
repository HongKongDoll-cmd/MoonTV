import {
  buildIntroSkipLabel,
  buildIntroSkipStorageKey,
  INTRO_SKIP_STORAGE_PREFIX,
  isTrustworthyIntroEnd,
  MAX_INTRO_SECONDS,
  MIN_AUTO_SKIP_SECONDS,
  MIN_DURATION_FOR_SKIP,
  resolveIntroEnd,
  resolveLearnedIntroEnd,
  shouldShowIntroSkip,
} from '../intro-skip';

describe('isTrustworthyIntroEnd', () => {
  test('正常片头长度可信', () => {
    expect(isTrustworthyIntroEnd(90)).toBe(true);
    expect(isTrustworthyIntroEnd(5)).toBe(true);
    expect(isTrustworthyIntroEnd(300)).toBe(true);
  });

  test('太短 / 非法 / 超上限不可信', () => {
    expect(isTrustworthyIntroEnd(0)).toBe(false);
    expect(isTrustworthyIntroEnd(4)).toBe(false);
    expect(isTrustworthyIntroEnd(MAX_INTRO_SECONDS + 1)).toBe(false);
    expect(isTrustworthyIntroEnd(-10)).toBe(false);
    expect(isTrustworthyIntroEnd(NaN)).toBe(false);
    expect(isTrustworthyIntroEnd(undefined)).toBe(false);
    expect(isTrustworthyIntroEnd(null)).toBe(false);
  });

  test('片头长于半集 = 多半拖错了，不信', () => {
    // 700 秒的一集：半集是 350，300 秒的片头可信，正好一半（350）起不可信
    expect(isTrustworthyIntroEnd(300, 700)).toBe(true);
    expect(isTrustworthyIntroEnd(350, 700)).toBe(false);
    expect(isTrustworthyIntroEnd(299, 500)).toBe(false);
  });
});

describe('resolveIntroEnd', () => {
  test('手填配置优先于记住的长度', () => {
    expect(resolveIntroEnd(120, 300, 2400)).toBe(120);
  });

  test('没有手填时用记住的长度', () => {
    expect(resolveIntroEnd(0, 300, 2400)).toBe(300);
  });

  test('手填超过上限时截断', () => {
    expect(resolveIntroEnd(9999, 0, 7200)).toBe(MAX_INTRO_SECONDS);
  });

  test('两者都没有 → 0（不知道片头多长）', () => {
    expect(resolveIntroEnd(0, 0, 2400)).toBe(0);
    expect(resolveIntroEnd(0, undefined, 2400)).toBe(0);
    // 记住的长度不可信时也不能用
    expect(resolveIntroEnd(0, 9999, 2400)).toBe(0);
    // 集数太短导致不可信
    expect(resolveIntroEnd(0, 100, 150)).toBe(0);
  });
});

describe('shouldShowIntroSkip', () => {
  test('已知片头：在片头区间内显示', () => {
    expect(shouldShowIntroSkip(0, 90, 2400)).toBe(true);
    expect(shouldShowIntroSkip(5, 90, 2400)).toBe(true);
    expect(shouldShowIntroSkip(85, 90, 2400)).toBe(true);
  });

  test('已知片头：越过片头就不显示', () => {
    expect(shouldShowIntroSkip(90, 90, 2400)).toBe(false);
    expect(shouldShowIntroSkip(200, 90, 2400)).toBe(false);
  });

  test('未知片头：3 分钟候选窗内都显示', () => {
    expect(shouldShowIntroSkip(0, 0, 2400)).toBe(true);
    expect(shouldShowIntroSkip(120, 0, 2400)).toBe(true);
    expect(shouldShowIntroSkip(179, 0, 2400)).toBe(true);
    expect(shouldShowIntroSkip(185, 0, 2400)).toBe(false);
  });

  test('极短的片子不显示', () => {
    expect(shouldShowIntroSkip(5, 0, 60)).toBe(false);
    expect(shouldShowIntroSkip(5, 0, 0)).toBe(true); // 时长未知，不拦
  });

  test('非法输入不显示', () => {
    expect(shouldShowIntroSkip(NaN, 90, 2400)).toBe(false);
    expect(shouldShowIntroSkip(-1, 90, 2400)).toBe(false);
  });

  test('距片头结束不足 1 秒不打扰', () => {
    // 89.5 秒时距片头结束只剩 0.5 秒，点一下几乎没意义
    expect(shouldShowIntroSkip(89.5, 90, 2400)).toBe(false);
    expect(shouldShowIntroSkip(89, 90, 2400)).toBe(true);
  });
});

describe('buildIntroSkipLabel', () => {
  test('已知片头时长显示 mm:ss', () => {
    expect(buildIntroSkipLabel(90)).toBe('跳过片头 (01:30)');
    expect(buildIntroSkipLabel(5)).toBe('跳过片头 (00:05)');
    expect(buildIntroSkipLabel(615)).toBe('跳过片头 (10:15)');
  });

  test('未知片头时长只给文案', () => {
    expect(buildIntroSkipLabel(0)).toBe('跳过片头');
  });
});

describe('resolveLearnedIntroEnd', () => {
  test('已知片头：点一下就记住这个长度', () => {
    expect(resolveLearnedIntroEnd(10, 90, 2400)).toBe(90);
  });

  test('未知片头：把当前位置当作片头结束', () => {
    expect(resolveLearnedIntroEnd(96.4, 0, 2400)).toBe(96);
  });

  test('位置太早点了等于没跳，不记', () => {
    expect(resolveLearnedIntroEnd(2, 0, 2400)).toBe(0);
    expect(resolveLearnedIntroEnd(0, 0, 2400)).toBe(0);
    expect(resolveLearnedIntroEnd(NaN, 0, 2400)).toBe(0);
  });

  test('位置超过上限不记（避免拖错永久生效）', () => {
    expect(resolveLearnedIntroEnd(400, 0, 3600)).toBe(0);
  });

  test('位置长于半集不记', () => {
    expect(resolveLearnedIntroEnd(600, 0, 1000)).toBe(0);
  });

  test('短于最小可跳过长度不记', () => {
    expect(resolveLearnedIntroEnd(3, 0, 2400)).toBe(0);
    expect(resolveLearnedIntroEnd(MIN_AUTO_SKIP_SECONDS, 0, 2400)).toBe(
      MIN_AUTO_SKIP_SECONDS
    );
  });
});

describe('buildIntroSkipStorageKey', () => {
  test('按源与片名隔离', () => {
    const a = buildIntroSkipStorageKey('bilibili', 'ep1');
    const b = buildIntroSkipStorageKey('openlist', 'ep1');
    expect(a).not.toBe(b);
    expect(a.startsWith(INTRO_SKIP_STORAGE_PREFIX)).toBe(true);
  });

  test('含斜杠与空格的 id 不会产生奇怪字符', () => {
    const key = buildIntroSkipStorageKey('openlist', '/大目录/第001集.mkv');
    expect(key).toBe(
      `${INTRO_SKIP_STORAGE_PREFIX}openlist:_大目录_第001集.mkv`
    );
    expect(key).not.toMatch(/\s/);
  });
});

describe('时长阈值常量自洽', () => {
  test('MIN_DURATION_FOR_SKIP 大于最小可跳过长度（否则小片也能跳）', () => {
    expect(MIN_DURATION_FOR_SKIP).toBeGreaterThan(MIN_AUTO_SKIP_SECONDS);
  });
});
