/**
 * 豆瓣图片的**加载回退链**。
 *
 * 为什么需要它：豆瓣图 `img*.doubanio.com` 在部分网络下会直接失败
 * （被墙 / 防盗链 403 / 瞬时抖动），而 `<img>` 只给一次机会 ——
 * 一旦 `onError` 就只剩一个破图占位。
 *
 * 曾经的实现是「失败后把同一个 URL 再赋一次」（`img.src = processImageUrl(poster)`），
 * **那等于什么都没做**，所以「有时图片出不来」一直存在。
 *
 * 这里给出真正不同的候选，按「代价从低到高」排序：
 *
 * 1. `primaryUrl` —— 用户配置的方式；
 * 2. 自带服务端代理 `/api/image-proxy` 或原图直连（谁是首选，另一个就是次选）；
 * 3. cmliussss 公共 CDN —— 只换主机名，能治 doubanio 直连被墙。
 *
 * ## 4.6.3：默认从「直连」改为「全量走站内代理」
 *
 * 原来的默认是 direct，理由是「直连能用时零额外开销」。但实际部署里
 * 豆瓣图直连失败率很高（被墙 / 防盗链），首页、搜索、详情大量破图，
 * 用户反馈难看的比例高于服务器多扛的流量，因此**默认改为 server**：
 * 所有豆瓣图首屏就走 `/api/image-proxy`，浏览器只访问自己域名。
 * 想省服务器流量可在管理台把「豆瓣图片代理」改回 direct，
 * 或用 `NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE=direct` 覆盖。
 * 配套把 `/api/image-proxy` 的限流从 120 次/分提高到 600 次/分，
 * 否则全量代理会先撞限流（那会比直连失败更糟）。
 *
 * 本模块**不 import 任何东西**，纯字符串处理，便于单测，也方便被
 * 客户端组件与服务端代码同时引用。
 */

/** 自带的服务端图片代理（带豆瓣 Referer + UA，见 src/app/api/image-proxy/route.ts） */
export const SERVER_IMAGE_PROXY_PATH = '/api/image-proxy';

/** cmliussss 公共豆瓣图 CDN（国内可达，只替换主机名） */
export const CMLIUSSSS_IMAGE_HOST = 'img.doubanio.cmliussss.net';

const DOUBAN_IMAGE_HOST_RE = /img\d+\.doubanio\.com/gi;

/** 是否是豆瓣图（只有豆瓣图才有必要走这套回退） */
export function isDoubanImageUrl(url: string): boolean {
  return !!url && url.toLowerCase().includes('doubanio.com');
}

/** 包装成自带服务端代理地址 */
export function buildServerProxyUrl(url: string): string {
  if (!url) return '';
  return `${SERVER_IMAGE_PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

/** 换成 cmliussss CDN 主机名；本就不是 `img<N>.doubanio.com` 形式时返回空串 */
export function buildCmliussssUrl(url: string): string {
  if (!url) return '';
  const replaced = url.replace(DOUBAN_IMAGE_HOST_RE, CMLIUSSSS_IMAGE_HOST);
  // 没发生替换说明主机名形状不匹配，硬塞进这个 CDN 只会 404
  return replaced === url ? '' : replaced;
}

/**
 * 生成按优先级排序的候选列表（含首位）。
 *
 * `primaryUrl` 由调用方通过 `processImageUrl()` 得到（那函数依赖 localStorage，
 * 不适合放进本模块）。非豆瓣图只返回 `primaryUrl` —— 别的源站不经豆瓣代理，
 * 也不该被塞进豆瓣 CDN。
 *
 * 4.6.3 起默认改为**全量走站内代理**（`primaryUrl` 就是 `/api/image-proxy`）。
 * 此时回退链要反过来：次选放**原图直连**（治服务器到不了豆瓣的情况），
 * 再放公共 CDN。若仍按老顺序把代理地址再推一遍，第一级失败后第二级还是
 * 同一个地址，等于白试一次。
 *
 * 返回值去重且去掉空项，调用方从下标 1 开始逐级回退即可。
 */
export function buildImageCandidates(
  originalUrl: string,
  primaryUrl: string
): string[] {
  const url = (originalUrl || '').trim();
  if (!url && !primaryUrl) return [];

  const candidates: string[] = [];
  const push = (candidate: string) => {
    const value = (candidate || '').trim();
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  // 首选：用户配置的方式
  push(primaryUrl || url);

  if (!isDoubanImageUrl(url)) return candidates;

  const primaryIsServerProxy =
    !!primaryUrl && primaryUrl.startsWith(`${SERVER_IMAGE_PROXY_PATH}?`);

  if (primaryIsServerProxy) {
    // 次选：原图直连（服务器侧取不到时，浏览器直连也许可以）
    push(url);
    // 末选：公共 CDN（治 doubanio 直连被墙）
    push(buildCmliussssUrl(url));
  } else {
    // 次选：自带服务端代理（治防盗链；浏览器只访问自己域名）
    push(buildServerProxyUrl(url));
    // 末选：公共 CDN（治 doubanio 直连被墙）
    push(buildCmliussssUrl(url));
  }

  return candidates;
}

/**
 * 取下一个回退候选；已无候选时返回 `null`（调用方应保留占位图，别再重试）。
 *
 * `step` 是**已经失败的次数**：0 表示首选刚失败，此时应返回下标 1。
 */
export function nextImageFallback(
  candidates: string[],
  step: number
): string | null {
  if (!Number.isFinite(step) || step < 0) return null;
  const index = Math.floor(step) + 1;
  if (index < 0 || index >= candidates.length) return null;
  return candidates[index] ?? null;
}

// ---------------------------------------------------------------------------
// DOM 侧（唯一有副作用的部分，单独放，便于一眼分辨）
// ---------------------------------------------------------------------------

/** 记录「当前这张图是哪张海报」的 dataset 键，用于换图时重置回退计数 */
const FALLBACK_FOR_KEY = 'imgFallbackFor';
/** 记录已失败次数的 dataset 键 */
const FALLBACK_STEP_KEY = 'imgFallbackStep';

/**
 * 在 `<img>` 上执行一次回退。返回是否真的切换了地址。
 *
 * 调用方通常是 `onError`：
 * ```tsx
 * onError={(e) => applyImageFallback(e.target as HTMLImageElement, poster, processImageUrl(poster))}
 * ```
 *
 * 两个必须一起做的动作，漏掉任一个都会让回退失效：
 * - **换图要重置计数**：`actualPoster` 变了之后如果继续沿用上一个计数，
 *   新图会从第 2、3 级开始试，平白丢掉首选。
 * - **清掉 `srcset` / `sizes`**：只改 `src` 时，浏览器仍可能按旧的
 *   srcset 候选集取图，于是"换了地址"但请求的还是原来那个。
 */
export function applyImageFallback(
  img: HTMLImageElement,
  originalUrl: string,
  primaryUrl: string
): boolean {
  const posterKey = originalUrl || primaryUrl;
  if (img.dataset[FALLBACK_FOR_KEY] !== posterKey) {
    img.dataset[FALLBACK_FOR_KEY] = posterKey;
    img.dataset[FALLBACK_STEP_KEY] = '0';
  }

  const step = Number(img.dataset[FALLBACK_STEP_KEY] || '0');
  const next = nextImageFallback(
    buildImageCandidates(originalUrl, primaryUrl),
    Number.isFinite(step) ? step : 0
  );
  if (!next) return false;

  img.dataset[FALLBACK_STEP_KEY] = String(step + 1);
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.src = next;
  return true;
}

