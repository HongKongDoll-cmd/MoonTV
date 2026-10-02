'use client';

import { Keyboard, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PLAYER_HOTKEYS } from '@/lib/player-hotkeys';

/**
 * 播放器快捷键说明。
 *
 * 4.5.6 起 ArtPlayer 的 hotkey 打开了（此前是关的，键盘完全没反应），
 * 但快捷键属于「看不见的功能」，不给提示用户根本不知道能这么用。
 *
 * 刻意做成播放页顶部操作栏里的独立按钮，而不是塞进 ArtPlayer 设置面板：
 * 面板项的 onSelect/onClick 有返回值写回 DOM 的坑（见项目记忆），
 * 这里自己画一个弹层更可控，也方便在手机端当说明页用。
 */
export function HotkeyHelp() {
  const [open, setOpen] = useState(false);

  // 打开时按 Esc 关闭（与 ArtPlayer 自身的 Esc 行为不冲突：面板在播放器外）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
        title='查看播放器快捷键'
        aria-label='查看播放器快捷键'
        data-testid='hotkey-help-button'
      >
        <Keyboard className='h-4 w-4' />
        <span className='hidden sm:inline'>快捷键</span>
      </button>

      {open && (
        <div
          className='fixed inset-0 z-[900] flex items-center justify-center bg-black/40 p-4'
          onClick={() => setOpen(false)}
          data-testid='hotkey-help-panel'
        >
          <div
            className='w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-base font-medium text-gray-800 dark:text-gray-100'>
                播放器快捷键
              </h2>
              <button
                type='button'
                onClick={() => setOpen(false)}
                className='rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                title='关闭'
                aria-label='关闭'
              >
                <X className='h-4 w-4' />
              </button>
            </div>
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
      )}
    </>
  );
}
