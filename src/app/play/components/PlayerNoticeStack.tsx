'use client';

import { useSyncExternalStore } from 'react';

import {
  type PlayerNoticeItem,
  type PlayerNoticeLevel,
  playerNotices,
} from '@/lib/player-notices';

/**
 * 播放器右上角堆叠提示（4.7.2）。
 *
 * 数据来自 {@link playerNotices}，本身不持有状态，也不负责什么时候弹提示。
 *
 * 两个容易踩的点：
 *
 * 1. **全屏时必须 portal 到 fullscreenElement**。Fullscreen API 会把
 *    fullscreen 元素提升到 top layer 并盖住整个视口，挂在 `document.body`
 *    下或播放器**外层容器**里的节点都会被它遮住（4.6.5 踩过一次）。
 *    portal 的宿主节点由调用方传进来，这里只负责定位方式切换：
 *    全屏用 `fixed`（相对视口），非全屏用 `absolute`（相对播放器外框）。
 *
 * 2. **`top-16` 是为了避开顶部操作层**。返回/标题/字幕那几个按钮在
 *    `top-0`，提示贴 `top-3` 会直接压在按钮上，点都点不到。
 */

const EMPTY: PlayerNoticeItem[] = [];

const LEVEL_STYLE: Record<PlayerNoticeLevel, string> = {
  info: 'border-l-sky-400',
  warn: 'border-l-amber-400',
  error: 'border-l-red-400',
};

function subscribe(listener: () => void): () => void {
  return playerNotices.subscribe(listener);
}

function getSnapshot(): PlayerNoticeItem[] {
  return playerNotices.getItems();
}

function getServerSnapshot(): PlayerNoticeItem[] {
  // 服务端没有队列内容；返回同一个常量避免 useSyncExternalStore 无限循环
  return EMPTY;
}

export default function PlayerNoticeStack({
  fullscreen,
}: {
  /** 由调用方传入（PlayClient 已经在监听 fullscreenchange） */
  fullscreen: boolean;
}) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (items.length === 0) return null;

  // 最新在最上：队列按时间升序存，渲染反转
  const ordered = [...items].reverse();

  return (
    <div
      // pointer-events-none：提示不该拦住画面点击（尤其是双击快进/长按倍速）
      className={`pointer-events-none z-[650] flex w-[min(20rem,72vw)] flex-col gap-1.5 ${
        fullscreen ? 'fixed top-16 right-3' : 'absolute top-16 right-3'
      }`}
    >
      {ordered.map((item) => (
        <div
          key={item.id}
          className={`moontv-notice-in rounded-md border-l-2 bg-black/75 px-3 py-2 text-[13px] leading-snug text-white shadow-lg backdrop-blur-sm ${
            LEVEL_STYLE[item.level]
          }`}
          role='status'
          aria-live='polite'
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
