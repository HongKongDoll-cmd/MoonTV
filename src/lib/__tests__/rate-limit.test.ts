import {
  clientIpFromRequest,
  createRateLimiter,
  rateLimitResponse,
} from '../rate-limit';

describe('createRateLimiter', () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  test('窗口内未超量时放行并递减剩余次数', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').remaining).toBe(1);
    expect(limiter.hit('a').remaining).toBe(0);
    const blocked = limiter.hit('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  test('超出后给出合理的重试秒数', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now });
    limiter.hit('a');
    clock += 30_000; // 过了半分钟
    const blocked = limiter.hit('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(30);
  });

  test('窗口滑出后自动恢复', () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 2, now });
    limiter.hit('a');
    limiter.hit('a');
    expect(limiter.hit('a').allowed).toBe(false);
    clock += 10_001;
    expect(limiter.hit('a').allowed).toBe(true);
  });

  test('peek 不消耗额度', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now });
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
  });

  test('reset 让失败计数立刻归零（登录成功时用）', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now });
    limiter.hit('ip|admin');
    expect(limiter.hit('ip|admin').allowed).toBe(false);
    limiter.reset('ip|admin');
    expect(limiter.hit('ip|admin').allowed).toBe(true);
  });

  test('reset 不带参数时全清', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now });
    limiter.hit('a');
    limiter.hit('b');
    expect(limiter.size()).toBe(2);
    limiter.reset();
    expect(limiter.size()).toBe(0);
  });

  test('不同 key 互不影响', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('b').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  test('随机大量 key 不会撑爆内存', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 10, now });
    for (let i = 0; i < 200; i++) limiter.hit(`key-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(10);
  });

  test('非法参数不会让限流失效（至少 1 次 / 至少 1ms）', () => {
    const limiter = createRateLimiter({ windowMs: 0, max: 0, now });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  test('key 会被转成字符串（避免对象 key 泄漏）', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now });
    // @ts-expect-error 故意传非字符串
    expect(limiter.hit({ a: 1 }).allowed).toBe(true);
    // @ts-expect-error 同一个对象序列化后应是同一个 key
    expect(limiter.hit({ a: 1 }).allowed).toBe(false);
  });
});

// Jest 27 的沙箱不暴露 fetch 全局（Request/Response），这里用最小替身：
// 被测函数只用到 `request.headers.get()`，替身够用且不引额外依赖。
function makeRequest(headers: Record<string, string>): Request {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    headers: {
      get: (name: string) => lower.get(name.toLowerCase()) ?? null,
    },
  } as unknown as Request;
}

class FakeResponse {
  status: number;
  bodyText: string;
  headerMap: Map<string, string>;
  constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    this.bodyText = typeof body === 'string' ? body : JSON.stringify(body);
    this.status = init?.status ?? 200;
    this.headerMap = new Map(
      Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])
    );
  }
  headers = {
    get: (name: string) => this.headerMap.get(name.toLowerCase()) ?? null,
  };
  json() {
    return Promise.resolve(JSON.parse(this.bodyText));
  }
}

(globalThis as any).Response = FakeResponse;

describe('clientIpFromRequest', () => {

  test('优先用 Cloudflare 的头', () => {
    const req = makeRequest({
      'cf-connecting-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2',
    });
    expect(clientIpFromRequest(req)).toBe('1.1.1.1');
  });

  test('其次 x-real-ip，再次 x-forwarded-for 的第一段', () => {
    expect(
      clientIpFromRequest(makeRequest({ 'x-real-ip': '3.3.3.3', 'x-forwarded-for': '4.4.4.4' }))
    ).toBe('3.3.3.3');
    expect(clientIpFromRequest(makeRequest({ 'x-forwarded-for': '5.5.5.5, 6.6.6.6' }))).toBe('5.5.5.5');
  });

  test('取不到时返回空串', () => {
    expect(clientIpFromRequest(makeRequest({}))).toBe('');
  });
});

describe('rateLimitResponse', () => {
  test('返回 429 + Retry-After 头 + 中文提示', async () => {
    const res = rateLimitResponse(
      { allowed: false, remaining: 0, retryAfterSec: 42 },
      '请求过于频繁'
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body: any = await res.json();
    expect(body.error).toBe('请求过于频繁');
    expect(body.retryAfterSec).toBe(42);
  });
});
