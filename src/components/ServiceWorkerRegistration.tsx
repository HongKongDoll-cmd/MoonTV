'use client';

import { useEffect } from 'react';

import { detectStreamingCapability } from '@/lib/stream-saver-fallback';

/**
 * Service Worker 注册。
 *
 * 一个 SW 同时承担两件事（4.5.6 起）：
 *   1. StreamSaver「边下边存」的流式下载通道（`/sw.js` 里的消息协议）；
 *   2. PWA 离线壳：缓存静态资源，断网时给出 `/offline.html` 提示页，
 *      配合 `public/manifest.json` 让站点可「添加到桌面」独立窗口打开。
 *
 * 两条职责在 SW 内部按 URL 让开，不会互相 respondWith。
 *
 * 两个关键取舍：
 * - **开发环境不注册**：SW 会缓存静态资源与页面，直接影响 HMR
 *   （「刚改完刷新还是旧的」），所以只在生产构建里启用。
 * - **不再依赖流式能力探测**：以前只有浏览器支持 StreamSaver 才注册，
 *   那是为下载服务的；现在离线壳与它无关，所以无条件注册。
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // 边下边存能力探测：只用于日志，不阻断注册
    const cap = detectStreamingCapability();

    fetch('/sw.js', { method: 'HEAD' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Service Worker 文件不存在');
        }
        return navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
      })
      .then((reg) => {
        console.log('✅ Service Worker 已注册（离线壳 + 边下边存）');
        console.log(`   当前流式下载方式：${cap.method}`);
        if (cap.method === 'blob') {
          console.warn(
            `⚠️ 当前浏览器走 Blob 降级方案（${cap.limitation || '兼容性限制'}），` +
              '边下边存体验受限；换 Chrome / Edge 更好'
          );
        }
        reg.addEventListener('updatefound', () => {
          console.log('Service Worker 发现更新');
        });
      })
      .catch((err) => {
        console.warn('⚠️ Service Worker 注册失败:', err.message);
      });
  }, []);

  return null;
}
