'use client';

import { useEffect } from 'react';

import { SYNCABLE_SETTINGS } from '@/lib/settings-sync';
import { useSettingsSync } from '@/hooks/useSettingsSync';

/**
 * 设置同步的挂载点（4.6.1）
 *
 * 单独抽成 Provider 而不是塞进 ThemeProvider，理由是职责：
 * 主题应用是「渲染期」的事，设置同步是「副作用 + 网络」的事，
 * 混在一起会让 ThemeProvider 变成什么都干的大杂烩。
 *
 * 挂在 layout 最外层的意义：**全站只建一次同步上下文**，
 * 任何页面切进来都已经完成拉取，不会有某个页面忘记初始化。
 */
export function SettingsSyncProvider({ children }: { children: React.ReactNode }) {
  // 调一次即可：hook 内部自己管拉取/上传/清理
  useSettingsSync();

  // 云端设置落地后，主题色/侧边栏这些「自己管 state」的组件需要重读一次。
  // 这里统一补一层：同步事件到达时若当前页面还没反映出来，主动刷新一次。
  useEffect(() => {
    const onSynced = () => {
      // 主题是挂在内联脚本上的（见 globals.css / head script），
      // 改 palette 需要重新应用，直接 reload 最稳妥也最省事。
      // 只在「本地确实变了」时才刷新，避免无谓的白屏。
      try {
        const current = window.localStorage.getItem('moontv_theme_palette');
        const applied = document.documentElement.dataset.themePalette;
        if (current && applied && current !== applied) {
          window.location.reload();
          return;
        }
      } catch {
        /* localStorage 不可用则跳过 */
      }
    };
    window.addEventListener('moontv-settings-synced', onSynced);
    return () => window.removeEventListener('moontv-settings-synced', onSynced);
  }, []);

  return <>{children}</>;
}

/**
 * 白名单键的调试输出（管理台设置页用得上：告诉用户「哪些设置会同步」）
 */
export function getSyncableSettingKeys(): string[] {
  return Object.keys(SYNCABLE_SETTINGS);
}
