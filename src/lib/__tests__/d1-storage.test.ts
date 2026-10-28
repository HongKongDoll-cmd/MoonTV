import { D1_SCHEMA_SQL, D1Storage, __setD1DatabaseForTest } from '../d1.db';

/** 造一个最小的 D1 绑定替身，记录 exec / prepare 的调用情况 */
function createFakeD1(options: { execImpl?: () => Promise<unknown> } = {}) {
  const calls = { exec: 0, prepare: 0 };

  const db = {
    exec: async () => {
      calls.exec += 1;
      return options.execImpl ? options.execImpl() : { count: 0, duration: 0 };
    },
    prepare: () => {
      calls.prepare += 1;
      return {
        bind: () => ({
          first: async () => null,
          all: async () => ({ success: true, results: [] }),
          run: async () => ({ success: true }),
        }),
        first: async () => null,
        all: async () => ({ success: true, results: [] }),
        run: async () => ({ success: true }),
      };
    },
  };

  return { db, calls };
}

describe('D1 建表 DDL', () => {
  test('覆盖全部业务表（漏一张就会在对应功能上 500）', () => {
    const tables = [
      'users',
      'play_records',
      'favorites',
      'followings',
      'search_history',
      'skip_configs',
      'user_settings',
      'today_updated',
      'admin_config',
    ];
    for (const table of tables) {
      expect(D1_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  test('全部使用 IF NOT EXISTS（必须可反复执行，不能碰已有数据）', () => {
    const creates = D1_SCHEMA_SQL.match(/CREATE TABLE/g) ?? [];
    const idempotent = D1_SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
    expect(creates.length).toBe(idempotent.length);
  });
});

describe('D1Storage 绑定校验', () => {
  afterEach(() => {
    __setD1DatabaseForTest(null);
  });

  test('构造阶段**不**读取绑定（构建期没有绑定，读了会让构建失败）', () => {
    __setD1DatabaseForTest(null);
    // 必须 delete：赋 undefined 会被 Node 存成字符串 "undefined"，不是真的移除
    delete (process.env as Record<string, unknown>).DB;

    // next build 的 Collecting page data 会加载模块并 new D1Storage，
    // 那一刻没有任何绑定；这里要是抛错，整个部署就挂在这一步
    expect(() => new D1Storage()).not.toThrow();
  });

  test('真正查询时才抛出可操作的错误（而不是 undefined.prepare）', async () => {
    __setD1DatabaseForTest(null);
    delete (process.env as Record<string, unknown>).DB;

    const storage = new D1Storage();
    await expect(storage.getAllFollowings('u')).rejects.toThrow(/D1 绑定缺失/);
  });

  test('值形如字符串时不被误当成绑定（process.env 赋 undefined 的坑）', async () => {
    __setD1DatabaseForTest(null);
    (process.env as Record<string, unknown>).DB = 'undefined';

    const storage = new D1Storage();
    await expect(storage.getAllFollowings('u')).rejects.toThrow(/D1 绑定缺失/);
    delete (process.env as Record<string, unknown>).DB;
  });

  test('注入的替身会被直接使用（不经环境变量）', () => {
    __setD1DatabaseForTest({ prepare: () => ({}) } as unknown as never);
    expect(() => new D1Storage()).not.toThrow();
  });

  test('绑定正常时构造成功', () => {
    const { db } = createFakeD1();
    __setD1DatabaseForTest(db as unknown as never);
    expect(() => new D1Storage()).not.toThrow();
  });
});

describe('D1Storage 自动建表', () => {
  afterEach(() => {
    __setD1DatabaseForTest(null);
  });

  test('首次读写前会执行一次建表，且只执行一次', async () => {
    const { db, calls } = createFakeD1();
    __setD1DatabaseForTest(db as unknown as never);
    const storage = new D1Storage();

    await storage.getAllFollowings('u');
    expect(calls.exec).toBe(1);

    await storage.getAllFollowings('u');
    await storage.getAllFavorites('u');
    // 实例级去重：后续调用不能反复跑 DDL
    expect(calls.exec).toBe(1);
  });

  test('建表失败不阻断后续查询（让真实错误自己冒出来）', async () => {
    const { db } = createFakeD1({
      execImpl: () => Promise.reject(new Error('not authorized')),
    });
    __setD1DatabaseForTest(db as unknown as never);
    const storage = new D1Storage();

    await expect(storage.getAllFollowings('u')).resolves.toEqual({});
  });
});
