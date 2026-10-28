'use client';

import { Keyboard, X } from 'lucide-react';
import { useEffect } from 'react';

import { PLAYER_HOTKEYS } from '@/lib/player-hotkeys';

/**
 * 播放器「操作说明」（4.7.2）。
 *
 * 4.5.6 起这里只有一张快捷键表，而快捷键属于「看不见的功能」——
 * 更不用说手机端根本没有键盘，只在桌面显示的那张表对手机用户毫无用处。
 * 现在改成两段：**触摸操作**（所有人可见）+ **键盘快捷键**（`md` 以上才显示）。
 *
 * 刻意不做成 ArtPlayer 设置面板的一项直接展开，而是自己画弹层：
 * 面板项的 onSelect/onClick 有「返回值写回 DOM」的坑（见项目记忆），
 * 而且这张表内容较长，塞进设置子面板会很难读。
 *
 * ⚠️ 弹层本体**不含 portal**：播放器全屏时它会被 top layer 遮住，
 * 由调用方（PlayClient）决定挂到 `document.fullscreenElement` 还是原地。
 */

/** 触摸操作说明：只写**已确认存在**的行为，不写没实现的手势 */
const TOUCH_TIPS: { gesture: string; action: string }[] = [
  { gesture: '单击画面', action: '显示 / 隐藏控制栏' },
  { gesture: '双击画面', action: '播放 / 暂停' },
  { gesture: '左右滑动', action: '调节播放进度' },
  { gesture: '横屏', action: '播放器自动铺满屏幕' },
];

export function PlayHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='pointer-events-auto flex items-center gap-1 rounded-md px-2 py-1 text-sm text-white/80 transition-colors hover:bg-white/15 hover:text-white'
      title='查看操作说明'
      aria-label='查看操作说明'
      data-testid='play-help-button'
    >
      <Keyboard className='h-4 w-4' />
      <span className='hidden sm:inline'>操作说明</span>
    </button>
  );
}

export function PlayHelpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // 打开时按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className='fixed inset-0 z-[900] flex items-center justify-center bg-black/50 p-4'
      onClick={onClose}
      data-testid='play-help-panel'
    >
      <div
        className='max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='mb-3 flex items-center justify-between'>
          <h2 className='text-base font-medium text-gray-800 dark:text-gray-100'>
            操作说明
          </h2>
          <button
            type='button'
            onClick={onClose}
            className='rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            title='关闭'
            aria-label='关闭'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <h3 className='mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400'>
          触摸操作
        </h3>
        <ul className='mb-4 flex flex-col gap-1.5'>
          {TOUCH_TIPS.map((item) => (
            <li
              key={item.gesture}
              className='flex items-center justify-between gap-3 text-sm'
            >
              <span className='rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'>
                {item.gesture}
              </span>
              <span className='text-right text-gray-600 dark:text-gray-300'>
                {item.action}
              </span>
            </li>
          ))}
        </ul>

        {/* 手机没有物理键盘，这一段不必占屏幕 */}
        <div className='hidden md:block'>
          <h3 className='mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400'>
            键盘快捷键
          </h3>
          <ul className='flex flex-col gap-1.5'>
            {PLAYER_HOTKEYS.map((item) => (
              <li
                key={item.keys}
                className='flex items-center justify-between gap-3 text-sm'
              >
                <kbd className='rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'>
                  {item.keys}
                </kbd>
                <span className='text-right text-gray-600 dark:text-gray-300'>
                  {item.action}
                </span>
              </li>
            ))}
          </ul>
          <p className='mt-3 text-xs text-gray-500 dark:text-gray-400'>
            快捷键只在鼠标位于播放器区域内时生效，不会影响页面滚动。
          </p>
        </div>
      </div>
    </div>
  );
}
