/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  BarChart3,
  Cat,
  Clapperboard,
  Clover,
  Compass,
  Download,
  Film,
  FolderOpen,
  Home,
  Search,
  Trophy,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { memo, useEffect, useState } from 'react';

import { useDownloadTaskCount } from '@/hooks/useDownloadTaskCount';

import DownloadManagerModal from '@/components/DownloadManager';

import { useNavigationLoading } from './NavigationLoadingProvider';

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const { startLoading } = useNavigationLoading();

  // 当前激活路径：优先使用传入的 activePath，否则回退到浏览器地址
  const currentActive = activePath ?? pathname;

  const [navItems] = useState([
    { icon: Home, label: '首页', href: '/' },
    { icon: Search, label: '搜索', href: '/search' },
    // 4.5.9：手机端补齐桌面侧边栏已有的三个入口（影库/榜单/观影统计）
    { icon: FolderOpen, label: '影库', href: '/library' },
    {
      icon: Film,
      label: '电影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '剧集',
      href: '/douban?type=tv',
    },
    {
      icon: Clapperboard,
      label: '短剧',
      href: '/douban?type=short',
    },
    {
      icon: Compass,
      label: '纪录片',
      href: '/douban?type=doc',
    },
    {
      icon: Cat,
      label: '动漫',
      href: '/douban?type=anime',
    },
    {
      icon: Clover,
      label: '综艺',
      href: '/douban?type=show',
    },
    { icon: Trophy, label: '榜单', href: '/ranking' },
    { icon: BarChart3, label: '观影统计', href: '/stats' },
  ]);

  // 下载任务角标（与桌面侧边栏同一个 hook，SSR 阶段不渲染）
  const downloadTaskCount = useDownloadTaskCount();

  // 检查是否启用简洁模式 - 使用状态管理
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);
  // 4.5.9：下载管理弹窗
  const [downloadOpen, setDownloadOpen] = useState(false);

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        setSimpleMode(JSON.parse(savedSimpleMode));
      }
    }
  }, []);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // 解码URL以进行正确的比较
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className='md:hidden fixed left-0 right-0 z-[600] bg-white/90 backdrop-blur-xl border-t border-gray-200/50 overflow-hidden dark:bg-gray-900/80 dark:border-gray-700/50'
      style={{
        /* 紧贴视口底部，同时在内部留出安全区高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        minHeight: 'calc(3.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <ul className='flex items-center overflow-x-auto scrollbar-hide'>
        {navItems.map((item) => {
          const active = isActive(item.href);
          
          // 简洁模式下只显示首页和搜索，但在服务器端渲染时先不渲染
          if (!isClient) {
            return null; // 服务器端渲染时不显示任何内容，避免闪烁
          }
          
          if (simpleMode && !['/', '/search'].includes(item.href)) {
            return null;
          }

          return (
            <li
              key={item.href}
              className='flex-shrink-0'
              style={{
                width: simpleMode ? '50vw' : '20vw',
                minWidth: simpleMode ? '50vw' : '20vw'
              }}
            >
              <Link
                href={item.href}
                className='flex flex-col items-center justify-center w-full h-14 gap-1 text-xs'
                onClick={() => {
                  // 如果不是当前激活的链接，则触发加载动画
                  if (!active) {
                    startLoading();
                  }
                }}
              >
                <item.icon
                  className={`h-6 w-6 ${active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-500 dark:text-gray-400'
                    }`}
                />
                <span
                  className={
                    active
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-gray-600 dark:text-gray-300'
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}

        {/* 4.5.9：下载管理是弹窗（不是路由），所以这里单独放一个按钮，
            跟桌面侧边栏一致；角标用同一个 hook。 */}
        {isClient && (
          <li className='flex-shrink-0' style={{ width: '20vw', minWidth: '20vw' }}>
            <button
              type='button'
              onClick={() => setDownloadOpen(true)}
              className='relative flex w-full h-14 flex-col items-center justify-center gap-1 text-xs'
              aria-label='下载管理'
            >
              <span className='relative'>
                <Download className='h-6 w-6 text-gray-500 dark:text-gray-400' />
                {downloadTaskCount > 0 && (
                  <span className='absolute -top-1.5 -right-2.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] leading-[1.1rem] text-white'>
                    {downloadTaskCount > 99 ? '99+' : downloadTaskCount}
                  </span>
                )}
              </span>
              <span className='text-gray-600 dark:text-gray-300'>下载</span>
            </button>
          </li>
        )}
      </ul>

      {downloadOpen && (
        <DownloadManagerModal
          isOpen={downloadOpen}
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </nav>
  );
};

// 使用 React.memo 优化，避免父组件更新时导致不必要的重新渲染
export default memo(MobileBottomNav);
