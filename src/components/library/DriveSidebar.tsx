'use client';


import type { OpenListItem } from '@/lib/openlist';
import { resolveDriveVisual } from '@/lib/openlist';

import { DriveIcon } from './driveVisuals';

/**
 * 影库左侧的网盘列。
 *
 * 挂载的网盘 = 浏览根路径下的顶层目录（小雅 / 阿里云盘 / 115 …）。
 * 选中某个网盘 = 把右侧内容切到那个目录；选「全部」回到根路径。
 *
 * ## 为什么常驻左侧而不是只在根目录显示
 *
 * 进到深层目录后想换网盘是最常见的动作，把它藏起来就得先退回根目录。
 * 所以这一列在各种层级都在，且**不随目录变化重排**。
 *
 * ## 形态
 *
 * 桌面端 = 资源管理器式的导航窗格：贴内容区左缘、与右列等高、
 * 图标带同色系底块；移动端没有侧栏空间，退化为顶部一排横向滑动的
 * 网盘胶囊（不牺牲「随时换网盘」的能力）。
 */
export interface DriveSidebarProps {
  /** 根路径下的目录项（即挂载的网盘） */
  drives: OpenListItem[];
  /** 当前所在网盘名，空串 = 根目录（「全部」） */
  currentDrive: string;
  onSelect: (driveName: string) => void;
}

const ITEM_CLASS =
  'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm transition-colors';

const ACTIVE_CLASS =
  'bg-green-500/10 font-medium text-green-600 ring-1 ring-inset ring-green-500/30 dark:text-green-400';

const IDLE_CLASS =
  'text-gray-600 hover:bg-gray-100/70 dark:text-gray-300 dark:hover:bg-gray-800/70';

/** 桌面侧栏的一行（图标 + 名称，选中态高亮） */
const DriveRow = ({
  name,
  icon,
  active,
  title,
  onSelect,
}: {
  name: string;
  icon: React.ReactNode;
  active: boolean;
  title: string;
  onSelect: () => void;
}) => (
  <button
    type='button'
    onClick={onSelect}
    className={`${ITEM_CLASS} ${active ? ACTIVE_CLASS : IDLE_CLASS}`}
    title={title}
  >
    {icon}
    <span className='truncate'>{name}</span>
  </button>
);

const DriveSidebar = ({
  drives,
  currentDrive,
  onSelect,
}: DriveSidebarProps) => {
  const rows: Array<{
    key: string;
    name: string;
    title: string;
    active: boolean;
    icon: React.ReactNode;
    driveName: string;
  }> = [
    {
      key: '__all__',
      name: '全部',
      title: '全部文件（影库根目录）',
      active: currentDrive === '',
      icon: (
        <DriveIcon
          icon='cloud'
          tone='slate'
          className='h-5 w-5'
          withBackground
        />
      ),
      driveName: '',
    },
    ...drives.map((drive) => {
      const visual = resolveDriveVisual(drive.name);
      return {
        key: drive.name,
        name: drive.name,
        title: drive.name,
        active: currentDrive === drive.name,
        icon: (
          <DriveIcon
            icon={visual.icon}
            tone={visual.tone}
            className='h-5 w-5'
            withBackground
          />
        ),
        driveName: drive.name,
      };
    }),
  ];

  return (
    <>
      {/* 桌面：资源管理器式导航窗格（撑满与右列同高） */}
      <aside className='hidden w-56 flex-shrink-0 md:block lg:w-64'>
        <div className='flex h-full flex-col rounded-2xl border border-gray-200/70 bg-white/70 p-2 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/50'>
          <h2 className='px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'>
            网盘
          </h2>
          <ul className='space-y-1'>
            {rows.map((row) => (
              <li key={row.key}>
                <DriveRow
                  name={row.name}
                  title={row.title}
                  active={row.active}
                  icon={row.icon}
                  onSelect={() => onSelect(row.driveName)}
                />
              </li>
            ))}
          </ul>
          {/* 撑高用：网盘少时列表不塌在中间，视觉上仍然是完整的一栏 */}
          <div className='flex-1' />
          <p className='px-2.5 pb-1 pt-2 text-[11px] leading-4 text-gray-400 dark:text-gray-500'>
            点网盘切换，右侧显示里面的内容
          </p>
        </div>
      </aside>

      {/* 移动端：横向滑动胶囊行 */}
      <div className='mb-3 flex gap-2 overflow-x-auto pb-1 md:hidden'>
        {rows.map((row) => (
          <button
            key={row.key}
            type='button'
            onClick={() => onSelect(row.driveName)}
            className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
              row.active
                ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400'
                : 'border-gray-200/70 bg-white/60 text-gray-600 dark:border-gray-700/60 dark:bg-gray-900/40 dark:text-gray-300'
            }`}
          >
            {row.icon}
            {row.name}
          </button>
        ))}
      </div>
    </>
  );
};

export default DriveSidebar;
