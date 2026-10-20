import {
  DEFAULT_DANMAKU_THROTTLE,
  describeDanmakuThrottle,
  throttleDanmaku,
} from '../danmaku-throttle';
import type { DanmakuItem } from '../types';

function make(count: number, timeOf: (i: number) => number): DanmakuItem[] {
  return Array.from({ length: count }, (_, i) => ({
    time: timeOf(i),
    type: 1,
    color: 16777215,
    text: `弹幕${i}`,
  }));
}

describe('throttleDanmaku', () => {
  test('空/非法输入返回空数组', () => {
    expect(throttleDanmaku(null)).toEqual([]);
    expect(throttleDanmaku(undefined)).toEqual([]);
    expect(throttleDanmaku([])).toEqual([]);
  });

  test('低于阈值时原样返回（不白抽）', () => {
    const items = make(5, (i) => i * 2);
    expect(throttleDanmaku(items)).toEqual(items);
  });

  test('同一秒内超过上限时等距抽稀', () => {
    // 第 3 秒有 30 条
    const items = make(30, () => 3);
    const out = throttleDanmaku(items, { maxPerSecond: 10, maxTotal: 1000 });
    expect(out).toHaveLength(10);
    // 保持时序：取出来的仍是原顺序的子序列
    const picked = out.map((d) => Number(d.text.replace('弹幕', '')));
    const sorted = [...picked].sort((a, b) => a - b);
    expect(picked).toEqual(sorted);
    // 等距：首尾都应保留
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(29);
  });

  test('不同秒之间互不影响', () => {
    const items = [...make(3, () => 1), ...make(30, () => 2), ...make(4, () => 3)];
    const out = throttleDanmaku(items, { maxPerSecond: 10, maxTotal: 1000 });
    expect(out).toHaveLength(3 + 10 + 4);
    // 时序仍然升序
    const times = out.map((d) => d.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('总量超上限时全局等距抽稀', () => {
    // 120 秒，每秒 10 条 = 1200 条，压到 600
    const items: DanmakuItem[] = [];
    for (let s = 0; s < 120; s++) {
      items.push(...make(10, () => s));
    }
    const out = throttleDanmaku(items, {
      maxPerSecond: 10,
      maxTotal: 600,
    });
    expect(out).toHaveLength(600);
    const times = out.map((d) => d.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('小数时间按 floor 归桶', () => {
    const items = make(20, (i) => 5.9); // 同一秒内的不同小数
    const out = throttleDanmaku(items, { maxPerSecond: 5, maxTotal: 1000 });
    expect(out).toHaveLength(5);
    out.forEach((d) => expect(Math.floor(d.time)).toBe(5));
  });

  test('负数时间归到第 0 桶，不会丢', () => {
    const items = make(3, (i) => -1 - i);
    const out = throttleDanmaku(items, { maxPerSecond: 10, maxTotal: 1000 });
    expect(out).toHaveLength(3);
  });

  test('time 非有限数的条目被丢弃（脏数据不进插件）', () => {
    const items = [
      { time: 1, type: 1, color: 0, text: 'ok' },
      { time: NaN, type: 1, color: 0, text: 'bad' },
      { time: Infinity, type: 1, color: 0, text: 'bad' },
    ] as DanmakuItem[];
    expect(throttleDanmaku(items)).toHaveLength(1);
  });

  test('不修改入参', () => {
    const items = make(30, () => 1);
    const snapshot = items.map((d) => d.text);
    throttleDanmaku(items, { maxPerSecond: 5 });
    expect(items.map((d) => d.text)).toEqual(snapshot);
  });

  test('默认值与导出的常量一致', () => {
    expect(DEFAULT_DANMAKU_THROTTLE.maxPerSecond).toBe(10);
    expect(DEFAULT_DANMAKU_THROTTLE.maxTotal).toBe(600);
  });
});

describe('describeDanmakuThrottle', () => {
  test('统计原数与保留数', () => {
    const items = make(30, () => 1);
    const out = throttleDanmaku(items, { maxPerSecond: 10, maxTotal: 1000 });
    const stats = describeDanmakuThrottle(items, out);
    expect(stats).toEqual({ original: 30, kept: 10, dropped: 20 });
  });

  test('入参为 null 时 original 记 0', () => {
    expect(describeDanmakuThrottle(null, [])).toEqual({
      original: 0,
      kept: 0,
      dropped: 0,
    });
  });
});
