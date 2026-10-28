import {
  PLAYER_NOTICE_DURATION_MS,
  PLAYER_NOTICE_MAX,
  PlayerNoticeStore,
} from '../player-notices';

describe('PlayerNoticeStore', () => {
  let store: PlayerNoticeStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new PlayerNoticeStore();
  });

  afterEach(() => {
    store.clear();
    jest.useRealTimers();
  });

  test('按推入顺序保存，渲染时倒序即可让最新在最上', () => {
    store.push('第一条');
    store.push('第二条');
    const items = store.getItems();
    expect(items.map((i) => i.text)).toEqual(['第一条', '第二条']);
  });

  test('空白文本不入队（避免空卡片）', () => {
    store.push('   ');
    store.push('');
    expect(store.getItems()).toHaveLength(0);
  });

  test('同键提示是更新而非新增，且 id 保持不变', () => {
    const first = store.push('缓存中 3/50', { key: 'cache' });
    const second = store.push('缓存中 10/50', { key: 'cache' });

    expect(second).toBe(first);
    const items = store.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('缓存中 10/50');
  });

  test('同键更新后挪到最新位置（排在其它提示之后）', () => {
    store.push('A', { key: 'a' });
    store.push('B', { key: 'b' });
    store.push('A2', { key: 'a' });

    expect(store.getItems().map((i) => i.text)).toEqual(['B', 'A2']);
  });

  test('超出上限时挤掉最旧的一条', () => {
    for (let i = 1; i <= PLAYER_NOTICE_MAX + 2; i++) {
      store.push(`提示${i}`);
    }
    const items = store.getItems();
    expect(items).toHaveLength(PLAYER_NOTICE_MAX);
    expect(items[0].text).toBe('提示3');
    expect(items[items.length - 1].text).toBe(`提示${PLAYER_NOTICE_MAX + 2}`);
  });

  test('到期自动移除', () => {
    store.push('临时提示', { duration: 1000 });
    expect(store.getItems()).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(store.getItems()).toHaveLength(0);
  });

  test('同键更新会重置过期计时器', () => {
    store.push('缓冲中', { key: 'buf', duration: 1000 });
    jest.advanceTimersByTime(800);
    store.push('缓冲中 2', { key: 'buf', duration: 1000 });
    // 原计时器若未被重置，此刻应该已经被清掉
    jest.advanceTimersByTime(500);
    expect(store.getItems()).toHaveLength(1);
    jest.advanceTimersByTime(600);
    expect(store.getItems()).toHaveLength(0);
  });

  test('默认存活时间走常量', () => {
    store.push('默认');
    jest.advanceTimersByTime(PLAYER_NOTICE_DURATION_MS - 1);
    expect(store.getItems()).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(store.getItems()).toHaveLength(0);
  });

  test('duration 过小时被抬到下限，防止一闪而过', () => {
    store.push('太快', { duration: 10 });
    jest.advanceTimersByTime(400);
    expect(store.getItems()).toHaveLength(1);
    jest.advanceTimersByTime(200);
    expect(store.getItems()).toHaveLength(0);
  });

  test('可按 id 或 key 单独移除', () => {
    const id = store.push('A', { key: 'a' });
    store.push('B', { key: 'b' });

    store.dismiss(id);
    expect(store.getItems().map((i) => i.text)).toEqual(['B']);

    store.dismiss('b');
    expect(store.getItems()).toHaveLength(0);
  });

  test('移除不存在的键不会触发通知（避免无意义重渲染）', () => {
    store.push('A');
    const listener = jest.fn();
    store.subscribe(listener);
    store.dismiss('不存在');
    expect(listener).not.toHaveBeenCalled();
  });

  test('clear 清空全部并取消计时器，之后不会再有回调', () => {
    store.push('A', { duration: 1000 });
    store.push('B', { duration: 1000 });
    const listener = jest.fn();
    store.subscribe(listener);

    store.clear();
    expect(store.getItems()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);

    // 计时器若没被取消，这里会再触发一次 emit
    jest.advanceTimersByTime(2000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('订阅可取消', () => {
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.push('A');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.push('B');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('多次订阅各自都能收到', () => {
    const a = jest.fn();
    const b = jest.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.push('A');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
