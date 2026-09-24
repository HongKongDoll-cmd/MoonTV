import {
  BUFFER_HEALTH_LABELS,
  classifyBufferHealth,
  classifyPlaybackLink,
  formatBufferAhead,
  formatRefillRate,
  formatStallCount,
  PLAYBACK_LINK_LABELS,
} from '../playback-network';

describe('classifyPlaybackLink', () => {
  test('OpenList 中转下载路径 + sign → 中转', () => {
    expect(
      classifyPlaybackLink('http://127.0.0.1:5245/d/电影/E01.mkv?sign=abc')
    ).toBe('relay');
  });

  test('与影库地址同源 → 中转', () => {
    expect(
      classifyPlaybackLink(
        'http://127.0.0.1:5245/d/电影/E01.mkv',
        'http://127.0.0.1:5245'
      )
    ).toBe('relay');
  });

  test('Emby 流路径 → 中转', () => {
    expect(
      classifyPlaybackLink(
        'http://emby.local/Videos/123/stream?static=true&api_key=k'
      )
    ).toBe('relay');
  });

  test('网盘直链（其它域名）→ 直连', () => {
    expect(
      classifyPlaybackLink('https://cdn.aliyundrive.com/xyz/E01.mkv?auth=1')
    ).toBe('direct');
  });

  test('没有 /d/ 与 sign 的影库同域地址不算中转（除非同源）', () => {
    expect(
      classifyPlaybackLink('https://other.example.com/p/E01.mkv')
    ).toBe('direct');
  });

  test('空值 / 脏数据 → unknown', () => {
    expect(classifyPlaybackLink('')).toBe('unknown');
    expect(classifyPlaybackLink(undefined)).toBe('unknown');
    expect(classifyPlaybackLink('not a url')).toBe('unknown');
  });
});

describe('formatBufferAhead', () => {
  test('不足 1 分钟按秒显示', () => {
    expect(formatBufferAhead(0)).toBe('0 秒');
    expect(formatBufferAhead(12.7)).toBe('12 秒');
    expect(formatBufferAhead(59.9)).toBe('59 秒');
  });

  test('超过 1 分钟按分秒显示', () => {
    expect(formatBufferAhead(65)).toBe('1 分 05 秒');
    expect(formatBufferAhead(600)).toBe('10 分 00 秒');
  });

  test('无效值显示占位符', () => {
    expect(formatBufferAhead(null)).toBe('—');
    expect(formatBufferAhead(NaN)).toBe('—');
    expect(formatBufferAhead(-1)).toBe('—');
  });
});

describe('formatRefillRate', () => {
  test('一位小数', () => {
    expect(formatRefillRate(1.83)).toBe('1.8×');
    expect(formatRefillRate(0.5)).toBe('0.5×');
    expect(formatRefillRate(12)).toBe('12.0×');
  });

  test('无数据显示占位符', () => {
    expect(formatRefillRate(null)).toBe('—');
    expect(formatRefillRate(NaN)).toBe('—');
  });
});

describe('classifyBufferHealth', () => {
  test('缓冲足且补得快 → good', () => {
    expect(classifyBufferHealth({ bufferAhead: 30, refillRate: 2 })).toBe('good');
  });

  test('水位低 → starving（哪怕补得快）', () => {
    expect(classifyBufferHealth({ bufferAhead: 1, refillRate: 5 })).toBe('starving');
  });

  test('补缓冲跟不上 → starving（哪怕水位还有 20 秒）', () => {
    expect(classifyBufferHealth({ bufferAhead: 20, refillRate: 0.5 })).toBe('starving');
  });

  test('中间态 → tight', () => {
    expect(classifyBufferHealth({ bufferAhead: 5, refillRate: 3 })).toBe('tight');
    expect(classifyBufferHealth({ bufferAhead: 60, refillRate: 1.0 })).toBe('tight');
  });

  test('还没采到样 → unknown（不误报成 starving）', () => {
    expect(classifyBufferHealth({ bufferAhead: null })).toBe('unknown');
    expect(classifyBufferHealth({})).toBe('unknown');
  });
});

describe('formatStallCount', () => {
  test('0 次说「未卡顿」', () => {
    expect(formatStallCount(0)).toBe('未卡顿');
  });
  test('有次数直接报数', () => {
    expect(formatStallCount(3)).toBe('卡顿 3 次');
  });
});

describe('文案表', () => {
  test('每种状态都有中文标签', () => {
    expect(PLAYBACK_LINK_LABELS.relay).toBe('经影库服务器中转');
    expect(BUFFER_HEALTH_LABELS.starving).toBe('缓冲不足');
  });
});
