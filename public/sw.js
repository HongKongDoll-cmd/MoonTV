// Service Worker for streaming download
// Based on https://github.com/jimmywarting/StreamSaver.js

const urlDataMap = new Map()

function createStream(port) {
  return new ReadableStream({
    start(controller) {
      port.onmessage = ({ data }) => {
        if (data === 'end') {
          return controller.close()
        }
        if (data === 'abort') {
          controller.error('Aborted the download')
          return
        }
        controller.enqueue(data)
      }
    },
    cancel(reason) {
      console.log('user aborted', reason)
      port.postMessage({ abort: true })
    }
  })
}

// ---------------------------------------------------------------------------
// 离线壳（4.5.6）
// ---------------------------------------------------------------------------
// 这个 SW 同时干两件事：StreamSaver 边下边存 + PWA 离线壳。二者不冲突，
// 因为 StreamSaver 只对「已登记的下载 URL」调用 respondWith，其余请求它
// 直接 return null 放行。
//
// 缓存策略（刻意保守）：
// - 页面导航：**只走网络**，失败回退 /offline.html。**不把 HTML 写进缓存** ——
//   登录后的首页含用户名等个人数据，缓存下来会让共用设备的人离线时看到
//   上一个人的页面。
// - 静态资源（/_next/static、图标、字体、css/js/图片）：stale-while-revalidate，
//   命中缓存立刻返回、后台顺带更新。
// - /api/* 动态接口：一律不缓存，缓存这些只会显示过期数据。
//
// 注意：本文件是**唯一真源**，`public/sw.js` 每次 build 后由
// scripts/restore-sw.js 从这里重建。改 SW 只改这里。

const OFFLINE_CACHE = 'moontv-shell-v1'
/** install 时预缓存的静态外壳（不含任何页面） */
const OFFLINE_PRECACHE = [
  '/offline.html',
  '/manifest.json',
  '/logo.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
]
/** StreamSaver 已经接管（会 respondWith）的请求 URL */
const claimedUrls = new Set()
const STATIC_EXT_RE = /\.(?:css|js|mjs|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf)$/i
const STATIC_PATH_PREFIXES = ['/_next/static/', '/icons/']

function isStaticAsset (url) {
  if (STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return true
  }
  // /_next/image?url=... 是图片优化接口，属于可缓存的静态资源
  if (url.pathname === '/_next/image') return true
  return STATIC_EXT_RE.test(url.pathname)
}

async function networkFirstDocument (request) {
  try {
    return await fetch(request)
  } catch (error) {
    const cache = await caches.open(OFFLINE_CACHE)
    const fallback =
      (await cache.match('/offline.html')) ||
      (await cache.match('/manifest.json')) ||
      Response.error()
    return fallback
  }
}

async function staleWhileRevalidate (request) {
  const cache = await caches.open(OFFLINE_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {})
      }
      return response
    })
    .catch(() => null)
  return cached || (await network) || Response.error()
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE)
    // 单个资源缺失不该让整个 install 失败
    await Promise.all(
      OFFLINE_PRECACHE.map((url) => cache.add(url).catch(() => {}))
    )
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('moontv-shell-') && key !== OFFLINE_CACHE)
        .map((key) => caches.delete(key))
    )
    await self.clients.claim()
  })())
})

self.onmessage = (event) => {
  const data = event.data
  const port = event.ports[0]

  if (data === 'ping') {
    return
  }

  const downloadUrl = data.url || self.registration.scope + Math.random() + '/' + (typeof data === 'string' ? data : data.filename)
  const metadata = new Array(3)
  
  metadata[1] = data
  metadata[2] = port

  if (data.readableStream) {
    metadata[0] = data.readableStream
  } else if (data.transferringReadable) {
    port.onmessage = (evt) => {
      port.onmessage = null
      metadata[0] = evt.data.readableStream
    }
  } else {
    metadata[0] = createStream(port)
  }

  urlDataMap.set(downloadUrl, metadata)
  port.postMessage({ download: downloadUrl })
}

self.onfetch = (event) => {
  const url = event.request.url
  const hijacke = urlDataMap.get(url)

  if (!hijacke) return null

  const [stream, data, port] = hijacke

  // 登记一下：下面的离线 fetch 监听器注册得更晚，会在本次 respondWith
  // 之后才跑，此时 map 里已经没有这条了，靠它判断会漏
  claimedUrls.add(url)
  urlDataMap.delete(url)

  const responseHeaders = new Headers({
    'Content-Type': 'application/octet-stream; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block'
  })

  if (data.headers) {
    for (const [key, value] of Object.entries(data.headers)) {
      responseHeaders.set(key, value)
    }
  }

  event.respondWith(new Response(stream, { headers: responseHeaders }))
  port.postMessage({ debug: 'Download started' })
}

// 离线壳的 fetch 处理。
// 注册在 `self.onfetch` 之后，因此同一个请求上它**后**执行：
// StreamSaver 已经 respondWith 的请求由它负责，这里必须让开，
// 否则浏览器会抛「respondWith 已被调用」。
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  if (claimedUrls.has(request.url)) return

  let url
  try {
    url = new URL(request.url)
  } catch (error) {
    return
  }
  if (url.origin !== self.location.origin) return
  // 动态接口永不缓存
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request))
    return
  }
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
