/**
 * 播放列表与 AES key 的代理兜底（4.7.9）。
 *
 * 问题：采集站的 m3u8 与 AES key 经常直连拿不到，原因有三类 ——
 *  1. 源站校验 Referer / User-Agent，浏览器直连被 403；
 *  2. 源站没给跨域头，浏览器 fetch 直接抛 `Failed to fetch`（CORS）；
 *  3. 某些 CDN 对部分地区 / 来源做了限制。
 * 而站内的 `/api/m3u8?url=` 是**同源**代理，由服务端带正常的头部去取，
 * 上面三类都能绕过去。
 *
 * 为什么只给「播放列表」和「key」做兜底，不给分片做：
 * 分片的缓存键由 `buildSegmentCacheKey(url, useProxy)` 决定，直连键与代理键
 * 是两个不同的键。如果运行中途"失败后改用代理取"，缓存键会跟播放器读取时
 * 用的不一致 —— 预取写进去的分片命中不了，等于白下。分片走不走代理
 * 由统一的设置项决定，不能临时切换。
 */

/** 同源代理路径前缀 */
export const MEDIA_PROXY_PATH = '/api/m3u8';

/** 判断一个地址是否已经是同源代理地址（避免二次包装） */
export function isProxyUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  return url.startsWith(`${MEDIA_PROXY_PATH}?`) || url === MEDIA_PROXY_PATH;
}

/**
 * 构造同源代理地址。
 *
 * **只有浏览器端能拿到**（相对路径在 Node 里 fetch 不了）：
 * 服务端跑的时候返回 `null`，调用方据此跳过兜底。
 */
export function buildProxyUrl(url: string): string | null {
  if (typeof window === 'undefined') return null;
  if (typeof url !== 'string' || !url) return null;
  if (isProxyUrl(url)) return null;
  try {
    // 只代理 http(s)；data: / blob: 之类没有代理的意义
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${MEDIA_PROXY_PATH}?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return null;
  }
}

/** 一次请求失败的画像 */
export interface FetchFailureInfo {
  /** HTTP 状态码；没拿到响应时为 0 */
  status: number;
  /** 是否网络层失败（fetch 抛错） */
  networkError: boolean;
}

/**
 * 这次失败是否值得改用代理再试一次。
 *
 * - **404 / 410 不试**：文件确实不存在，代理去取也一样是 404，
 *   白白多一次往返还多占一个服务端请求；
 * - **401 / 403 要试**：大概率是 Referer / UA 校验，代理能过；
 * - **网络错误（含 CORS）要试**：这正是代理最能解决的问题；
 * - **5xx 要试**：源站可能是按来源 IP 限流，换服务端出口有机会成功。
 */
export function shouldFallbackToProxy(failure: FetchFailureInfo): boolean {
  const { status, networkError } = failure;
  if (networkError || status <= 0) return true;
  if (status === 404 || status === 410) return false;
  return true;
}

/** 把 fetch 抛出的错误归一成 {@link FetchFailureInfo} */
export function describeFetchError(_err: unknown): FetchFailureInfo {
  // 浏览器对 CORS / DNS / 连接被拒一律抛 TypeError: Failed to fetch，
  // 无法再细分（message 完全一样）；统一按网络层失败处理即可。
  // 参数保留是为了让调用点读起来明确，也便于将来接入更细的分类。
  return { status: 0, networkError: true };
}

export interface ProxyFallbackOptions {
  signal?: AbortSignal;
  /** 注入 fetch（测试用） */
  fetchImpl?: typeof fetch;
  /** 注入代理地址构造函数（测试/SSR 用），默认 {@link buildProxyUrl} */
  proxyUrlBuilder?: (url: string) => string | null;
  /** 兜底成功后回调，便于打日志 */
  onFallback?: (info: { reason: string; proxyUrl: string }) => void;
}

export interface ProxyFallbackResult<T> {
  value: T;
  /** 是否是通过代理取到的 */
  viaProxy: boolean;
}

async function fetchOnce(
  doFetch: typeof fetch,
  url: string,
  signal: AbortSignal | undefined
): Promise<Response> {
  return doFetch(url, { signal, credentials: 'omit', cache: 'no-store' });
}

/**
 * 先直连、失败再走代理地取一段内容。
 *
 * @param read 从 Response 里取出需要的数据（text / arrayBuffer）
 */
async function fetchWithFallback<T>(
  url: string,
  read: (response: Response) => Promise<T>,
  options: ProxyFallbackOptions
): Promise<ProxyFallbackResult<T>> {
  const doFetch = options.fetchImpl ?? fetch;
  const buildProxy = options.proxyUrlBuilder ?? buildProxyUrl;

  // 已经是代理地址：没有"再兜一层"的说法，直接请求
  if (isProxyUrl(url)) {
    const response = await fetchOnce(doFetch, url, options.signal);
    if (!response.ok) {
      throw new Error(`代理请求失败: ${response.status}`);
    }
    return { value: await read(response), viaProxy: true };
  }

  let failure: FetchFailureInfo | null = null;

  try {
    const response = await fetchOnce(doFetch, url, options.signal);
    if (response.ok) {
      return { value: await read(response), viaProxy: false };
    }
    failure = { status: response.status, networkError: false };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    failure = describeFetchError(err);
  }

  const proxyUrl = buildProxy(url);
  if (!proxyUrl || !shouldFallbackToProxy(failure)) {
    throw new Error(
      failure.networkError
        ? '请求失败（网络错误）'
        : `请求失败: ${failure.status}`
    );
  }

  options.onFallback?.({
    reason: failure.networkError ? 'network' : `http-${failure.status}`,
    proxyUrl,
  });

  // 代理这一层失败就直接抛，不再回落到第三次请求
  const proxied = await fetchOnce(doFetch, proxyUrl, options.signal);
  if (!proxied.ok) {
    throw new Error(`代理请求失败: ${proxied.status}`);
  }
  return { value: await read(proxied), viaProxy: true };
}

/** 取文本（播放列表） */
export function fetchTextWithProxyFallback(
  url: string,
  options: ProxyFallbackOptions = {}
): Promise<ProxyFallbackResult<string>> {
  return fetchWithFallback(url, (r) => r.text(), options);
}

/** 取二进制（AES key） */
export function fetchBufferWithProxyFallback(
  url: string,
  options: ProxyFallbackOptions = {}
): Promise<ProxyFallbackResult<ArrayBuffer>> {
  return fetchWithFallback(url, (r) => r.arrayBuffer(), options);
}
