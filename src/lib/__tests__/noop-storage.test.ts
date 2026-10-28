import { __emptyValueFor, createNoopStorage } from '../noop-storage';

describe('createNoopStorage', () => {
  const storage = createNoopStorage();

  test('读追更返回空对象（不是 null，调用方会直接 Object.entries）', async () => {
    await expect(storage.getAllFollowings('u')).resolves.toEqual({});
    await expect(storage.getAllFavorites('u')).resolves.toEqual({});
    await expect(storage.getAllPlayRecords('u')).resolves.toEqual({});
    await expect(storage.getAllSkipConfigs('u')).resolves.toEqual({});
  });

  test('单条读取返回 null', async () => {
    await expect(storage.getFollowing('u', 'k')).resolves.toBeNull();
    await expect(storage.getFavorite('u', 'k')).resolves.toBeNull();
    await expect(storage.getPlayRecord('u', 'k')).resolves.toBeNull();
    await expect(storage.getTodayUpdated('u')).resolves.toBeNull();
    await expect(storage.getAdminConfig()).resolves.toBeNull();
  });

  test('用户列表与跨设备设置返回空数组（IStorage 里明确约定的两个例外）', async () => {
    await expect(storage.getAllUsers()).resolves.toEqual([]);
    await expect(storage.getUserSettings('u')).resolves.toEqual([]);
  });

  test('校验类返回 false（本地模式下用户走 config，不走 db）', async () => {
    await expect(storage.verifyUser('u', 'p')).resolves.toBe(false);
    await expect(storage.checkUserExist('u')).resolves.toBe(false);
  });

  test('写操作静默成功，不抛错', async () => {
    await expect(storage.setFollowing('u', 'k', {} as never)).resolves.toBeUndefined();
    await expect(storage.setFavorite('u', 'k', {} as never)).resolves.toBeUndefined();
    await expect(storage.setTodayUpdated('u', {} as never)).resolves.toBeUndefined();
    await expect(storage.deleteFollowing('u', 'k')).resolves.toBeUndefined();
    await expect(storage.clearAllData()).resolves.toBeUndefined();
  });

  test('每个方法都返回 Promise（调用方全部 await，返回同步值会误用）', () => {
    const result = storage.getAllFollowings('u');
    expect(typeof (result as Promise<unknown>).then).toBe('function');
  });

  test('任意未来新增的方法也不会是 undefined（Proxy 兜住 IStorage 的增长）', async () => {
    const anyStorage = storage as unknown as Record<string, () => Promise<unknown>>;
    await expect(anyStorage.someFutureMethod()).resolves.toBeUndefined();
  });
});

describe('__emptyValueFor 规则', () => {
  test('getAll* 默认空对象，两个约定例外是空数组', () => {
    expect(__emptyValueFor('getAllFollowings')).toEqual({});
    expect(__emptyValueFor('getAllUsers')).toEqual([]);
    expect(__emptyValueFor('getUserSettings')).toEqual([]);
  });

  test('其它 get* 返回 null', () => {
    expect(__emptyValueFor('getFollowing')).toBeNull();
    expect(__emptyValueFor('getUserSettingsExtra')).toBeNull();
  });

  test('校验类返回 false，其余返回 undefined', () => {
    expect(__emptyValueFor('verifyUser')).toBe(false);
    expect(__emptyValueFor('checkUserExist')).toBe(false);
    expect(__emptyValueFor('setFollowing')).toBeUndefined();
    expect(__emptyValueFor('clearAllData')).toBeUndefined();
  });
});
