/**
 * 番组tv 图片地址改写（纯函数，客户端与服务端共用）。
 *
 * `/api/bangumi/calendar` 把上游 `lain.bgm.tv` 的封面改写成站内
 * `/api/image-proxy` 地址后返回，前端拿到的就是同源 URL ——
 * 不再有浏览器直连图片域名被墙 / 跨域 / https 页面混 http 的问题。
 *
 * 单独拆一个文件而不是写在 route.ts 里：route.ts 顶部 import 了
 * `next/server`，在 Jest 的 jsdom 沙箱里会因缺少 `Request` 全局而直接报错，
 * 导致这个纯函数根本没法被单测（Jest 27 不暴露 Request/Response）。
 */

/** 上游图片域名（要被改写的那些） */
export const BANGUMI_IMAGE_HOST = 'lain.bgm.tv';

/** 站内图片代理默认前缀 */
export const DEFAULT_IMAGE_PROXY_PREFIX = '/api/image-proxy?url=';

/**
 * 把数据里所有指向 `lain.bgm.tv` 的图片地址改写成代理地址。
 *
 * 递归处理数组 / 对象 / 字符串，只改字符串值，**不假设上游 JSON 的结构**
 * （Bangumi 加字段时不用跟着改），也不会修改入参。
 *
 * @param data 上游响应（已 JSON.parse）
 * @param proxyPrefix 代理前缀，约定以 `url=` 结尾，如 `/api/image-proxy?url=`
 */
export function rewriteBangumiImageUrls(
  data: unknown,
  proxyPrefix: string
): unknown {
  const prefix = proxyPrefix || DEFAULT_IMAGE_PROXY_PREFIX;
  const matcher = new RegExp(`^https?://${BANGUMI_IMAGE_HOST.replace('.', '\\.')}/`, 'i');

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      // 只处理以上游图片域名开头的地址，其他字符串原样返回
      if (!matcher.test(node)) return node;
      return prefix + encodeURIComponent(node);
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        out[key] = walk(value);
      }
      return out;
    }
    return node;
  };

  return walk(data);
}
