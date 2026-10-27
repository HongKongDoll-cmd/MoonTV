import {
  BUFFER_BUDGET_FLOOR,
  BUFFER_SHRINK_RATIO,
  shrinkBufferBudget,
} from '@/app/play/play-utils';

describe('shrinkBufferBudget（4.7.0 缓冲写满后的预算收紧）', () => {
  const INITIAL = {
    maxBufferSize: 150 * 1000 * 1000,
    maxBufferLength: 120,
    backBufferLength: 30,
  };

  test('按比例收紧三档', () => {
    const out = shrinkBufferBudget(INITIAL);
    expect(out.maxBufferSize).toBe(Math.round(150e6 * BUFFER_SHRINK_RATIO));
    expect(out.maxBufferLength).toBe(Math.round(120 * BUFFER_SHRINK_RATIO));
    expect(out.backBufferLength).toBe(Math.round(30 * BUFFER_SHRINK_RATIO));
  });

  test('不会收紧到 0：反复命中最终停在下限', () => {
    let cur = INITIAL;
    for (let i = 0; i < 30; i++) cur = shrinkBufferBudget(cur);

    expect(cur.maxBufferSize).toBe(BUFFER_BUDGET_FLOOR.maxBufferSize);
    expect(cur.maxBufferLength).toBe(BUFFER_BUDGET_FLOOR.maxBufferLength);
    expect(cur.backBufferLength).toBe(BUFFER_BUDGET_FLOOR.backBufferLength);
  });

  test('已在下限时继续调用保持不变（幂等）', () => {
    const once = shrinkBufferBudget(BUFFER_BUDGET_FLOOR);
    expect(once).toEqual(BUFFER_BUDGET_FLOOR);
  });

  test('小码率片源的初始预算也能被收，但不会低于下限', () => {
    const small = { maxBufferSize: 40e6, maxBufferLength: 40, backBufferLength: 12 };
    const out = shrinkBufferBudget(small);
    expect(out.maxBufferSize).toBeGreaterThanOrEqual(
      BUFFER_BUDGET_FLOOR.maxBufferSize
    );
    expect(out.maxBufferLength).toBeGreaterThanOrEqual(
      BUFFER_BUDGET_FLOOR.maxBufferLength
    );
    expect(out.backBufferLength).toBeGreaterThanOrEqual(
      BUFFER_BUDGET_FLOOR.backBufferLength
    );
  });

  test('纯函数：不修改入参', () => {
    const input = { ...INITIAL };
    shrinkBufferBudget(input);
    expect(input).toEqual(INITIAL);
  });

  test('返回的是整数（hls 配置项不接受小数时长）', () => {
    const out = shrinkBufferBudget({ maxBufferSize: 99e6, maxBufferLength: 77, backBufferLength: 33 });
    expect(Number.isInteger(out.maxBufferSize)).toBe(true);
    expect(Number.isInteger(out.maxBufferLength)).toBe(true);
    expect(Number.isInteger(out.backBufferLength)).toBe(true);
  });
});
