'use client';

import { Bell, Check } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getTodayUpdated } from '@/lib/db.client';
import { applyImageFallback } from '@/lib/douban-image';
import {
  type UpdateNotification,
  buildNotifications,
  canNotifySystem,
  markAsRead,
  notifySystem,
  readReadMap,
} from '@/lib/update-notification';
import { processImageUrl } from '@/lib/utils';

/** 多久检查一次新通知（毫秒） */
const POLL_INTERVAL = 5 * 60 * 1000;

/**
 * 更新通知铃铛（4.6.2）
 *
 * 挂在 layout 常驻，全站都能看到。数据源是已有的「今日新更」记录 ——
 * 不新增任何采集逻辑，只做「有变化 → 提醒用户点进去看」。
 *
 * 防噪音是这一块的重点（见 update-notification.ts）：
 * 同一天读过的条目当天不再提醒，第二天有新集才再响。
 */
export function UpdateNotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<UpdateNotification[]>([]);
  const [unread, setUnread] = useState(0);
  // 已弹过系统通知的 key，避免同一批内容重复弹系统通知
  const notifiedKeysRef = useRef<string[]>([]);

  /** 拉数据并计算未读 */
  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const record = await getTodayUpdated();
      const items = record && Array.isArray(record.items) ? record.items : [];
      const readMap = readReadMap(window.localStorage);
      const list = buildNotifications(items, readMap);
      setNotifications(list);
      setUnread(list.length);

      // 系统通知：只在「已授权 + 从没提醒过该 key」时弹一次
      if (list.length > 0 && canNotifySystem()) {
        const fresh = list.filter((n) => !notifiedKeysRef.current.includes(n.key));
        // 一次只弹第一条（系统通知轰炸比不通知更糟）
        if (fresh.length > 0) {
          const first = fresh[0];
          if (
            notifySystem(
              `${first.title} 有更新`,
              first.text,
              () => {
                window.location.href = first.href;
              }
            )
          ) {
            notifiedKeysRef.current = [...notifiedKeysRef.current, first.key];
          }
        }
      }
    } catch (err) {
      // 通知是「锦上添花」，失败不打扰用户
      console.warn('检查更新通知失败:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      // 打开面板即视为已读
      if (next && notifications.length > 0) {
        markAsRead(
          window.localStorage,
          notifications.map((n) => n.key)
        );
        setUnread(0);
      }
      return next;
    });
  }, [notifications]);

  // 点通知条目 → 标记已读并跳转
  const handleClickItem = useCallback((key: string) => {
    markAsRead(window.localStorage, [key]);
    setUnread((u) => Math.max(0, u - 1));
  }, []);

  return (
    <div className='relative'>
      <button
        type='button'
        onClick={handleOpen}
        data-testid='update-notification-bell'
        className='relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'
        title={unread > 0 ? `有 ${unread} 部剧有更新` : '更新通知'}
        aria-label={unread > 0 ? `更新通知，${unread} 条未读` : '更新通知'}
      >
        <Bell className='h-5 w-5' />
        {unread > 0 && (
          <span
            data-testid='update-notification-badge'
            className='absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white'
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 点外面关闭 */}
          <div
            className='fixed inset-0 z-[580]'
            onClick={() => setOpen(false)}
            aria-hidden='true'
          />
          <div
            data-testid='update-notification-panel'
            className='absolute right-0 top-full z-[590] mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900'
          >
            <div className='flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800'>
              <span className='text-sm font-medium text-gray-700 dark:text-gray-200'>
                更新通知
              </span>
              {notifications.length > 0 && (
                <span className='text-xs text-gray-400'>
                  {notifications.length} 条
                </span>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className='px-3 py-6 text-center text-sm text-gray-400'>
                暂时没有新内容
              </p>
            ) : (
              <ul className='max-h-96 overflow-y-auto'>
                {notifications.map((n) => (
                  <li key={n.key}>
                    <Link
                      href={n.href}
                      onClick={() => handleClickItem(n.key)}
                      className='flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    >
                      {n.poster ? (
                        <Image
                          src={processImageUrl(n.poster)}
                          alt={n.title}
                          width={40}
                          height={56}
                          className='h-14 w-10 flex-shrink-0 rounded object-cover'
                          referrerPolicy='no-referrer'
                          // 逐级回退：原地址 → 服务端代理 → 公共 CDN（与 VideoCard 同一套）
                          onError={(e) => {
                            const el = e.currentTarget;
                            if (!applyImageFallback(el, n.poster, processImageUrl(n.poster))) {
                              // 候选用尽，隐藏图片露出占位块
                              el.style.visibility = 'hidden';
                            }
                          }}
                        />
                      ) : (
                        <div className='h-14 w-10 flex-shrink-0 rounded bg-gray-200 dark:bg-gray-700' />
                      )}
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium text-gray-800 dark:text-gray-100'>
                          {n.title}
                        </p>
                        <p className='truncate text-xs text-gray-500 dark:text-gray-400'>
                          {n.text} · {n.sourceName}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <div className='border-t border-gray-100 px-3 py-1.5 dark:border-gray-800'>
              <button
                type='button'
                onClick={() => {
                  if (notifications.length > 0) {
                    markAsRead(
                      window.localStorage,
                      notifications.map((n) => n.key)
                    );
                  }
                  setUnread(0);
                }}
                className='flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
              >
                <Check className='h-3.5 w-3.5' />
                全部标为已读
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default UpdateNotificationBell;
