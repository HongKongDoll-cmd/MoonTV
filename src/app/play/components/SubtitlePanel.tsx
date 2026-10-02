'use client';

import { Captions, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  type SubtitleStylePreset,
  type SubtitleTrack,
  pickSubtitleTrack,
  SUBTITLE_STYLE_PRESETS,
  toSubtitleStyleObject,
} from '@/lib/subtitle';

/**
 * 字幕面板（4.5.7）。
 *
 * 只做两件被反复要的事，不做花活：
 *   1. 从影库同目录扫到的字幕里挑一条（按集数 + 语言自动挑，简体优先）；
 *   2. 字号三档 + 开关，样式落到 ArtPlayer 的 `subtitle.style()`。
 *
 * 刻意不接外部字幕站（要 key、有反爬，长期不可靠），改为在面板里留一个
 * 「自定义字幕地址」输入框，给自备字幕源的用户。
 *
 * 字幕地址**不经本站转发**：影库字幕就是网盘直链（raw_url），浏览器直接取。
 */

const STYLE_KEY = 'moontv_subtitle_preset';

export interface SubtitlePanelProps {
  /** 当前这一集对应的字幕轨（来自 detail.subtitles） */
  tracks: SubtitleTrack[];
  /** 当前集的视频文件名（用于按集数匹配） */
  videoName: string;
  /** 执行切换；返回是否成功（失败时面板会提示） */
  onSwitch: (track: SubtitleTrack | null) => Promise<boolean> | boolean;
  /** 当前生效的字幕（受控） */
  activeUrl: string | null;
  /** 样式预设变化 */
  onStyleChange: (preset: SubtitleStylePreset) => void;
  /** 初始样式预设 id */
  initialPresetId?: string;
}

function readStoredPreset(): string {
  if (typeof window === 'undefined') return 'medium';
  try {
    return localStorage.getItem(STYLE_KEY) || 'medium';
  } catch {
    return 'medium';
  }
}

export function SubtitlePanel({
  tracks,
  videoName,
  onSwitch,
  activeUrl,
  onStyleChange,
  initialPresetId,
}: SubtitlePanelProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState('');
  const [presetId, setPresetId] = useState(initialPresetId || 'medium');

  useEffect(() => {
    setPresetId(readStoredPreset());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 建议字幕：按集数 + 语言自动挑一条（仅用于面板里的「推荐」高亮）
  const suggested = pickSubtitleTrack(videoName, tracks);

  const applyPreset = (preset: SubtitleStylePreset) => {
    setPresetId(preset.id);
    onStyleChange(preset);
    try {
      localStorage.setItem(STYLE_KEY, preset.id);
    } catch {
      /* 隐私模式下写不进去，不影响使用 */
    }
  };

  const handleSwitch = async (track: SubtitleTrack | null) => {
    setSwitching(true);
    setError('');
    try {
      const ok = await onSwitch(track);
      if (!ok) setError('字幕加载失败，请换一个试试');
    } catch {
      setError('字幕加载失败，请换一个试试');
    } finally {
      setSwitching(false);
    }
  };

  const handleCustom = async () => {
    const url = customUrl.trim();
    if (!url) return;
    const track: SubtitleTrack = {
      name: '自定义字幕',
      url,
      type: url.toLowerCase().endsWith('.ass') ? 'ass' : url.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt',
      lang: 'unknown',
      fileName: 'custom',
      episodeKey: '',
    };
    await handleSwitch(track);
  };

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors ${
          activeUrl
            ? 'text-green-600 hover:bg-gray-100 dark:text-green-400 dark:hover:bg-gray-800'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
        }`}
        title='字幕设置'
        aria-label='字幕设置'
        data-testid='subtitle-button'
      >
        <Captions className='h-4 w-4' />
        <span className='hidden sm:inline'>字幕</span>
        {activeUrl && <span className='ml-0.5 h-1.5 w-1.5 rounded-full bg-green-500' />}
      </button>

      {open && (
        <div
          className='fixed inset-0 z-[900] flex items-center justify-center bg-black/40 p-4'
          onClick={() => setOpen(false)}
          data-testid='subtitle-panel'
        >
          <div
            className='w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='text-base font-medium text-gray-800 dark:text-gray-100'>
                字幕
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

            {/* 字号档位 */}
            <div className='mb-3 flex items-center gap-2'>
              <span className='text-xs text-gray-500 dark:text-gray-400'>字号</span>
              {SUBTITLE_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  onClick={() => applyPreset(preset)}
                  className={`h-7 w-7 rounded-md text-xs transition-colors ${
                    presetId === preset.id
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20'
                  }`}
                  title={`${preset.label}（${preset.fontSize}px）`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* 字幕列表 */}
            <div className='mb-3 flex flex-col gap-1'>
              <button
                type='button'
                disabled={switching}
                onClick={() => handleSwitch(null)}
                className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                  !activeUrl
                    ? 'bg-green-500/15 text-green-700 dark:text-green-300'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10'
                }`}
              >
                <span>关闭字幕</span>
              </button>

              {tracks.length === 0 ? (
                <p className='px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400'>
                  这个目录里没找到字幕文件（.srt / .ass / .vtt）。
                </p>
              ) : (
                tracks.map((track) => {
                  const isActive = activeUrl === track.url;
                  const isSuggested = suggested?.url === track.url;
                  return (
                    <button
                      key={track.url}
                      type='button'
                      disabled={switching}
                      onClick={() => handleSwitch(track)}
                      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-green-500/15 text-green-700 dark:text-green-300'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10'
                      }`}
                    >
                      <span className='truncate' title={track.fileName}>
                        {track.name}
                      </span>
                      {isSuggested && !isActive && (
                        <span className='flex-shrink-0 rounded bg-blue-500/15 px-1 text-[10px] text-blue-600 dark:text-blue-300'>
                          推荐
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* 自定义字幕地址 */}
            <div className='flex items-center gap-2'>
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder='自定义字幕直链（.srt / .ass）'
                className='h-7 min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 text-xs text-gray-800 placeholder-gray-400 focus:border-green-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
              />
              <button
                type='button'
                disabled={switching || !customUrl.trim()}
                onClick={handleCustom}
                className='h-7 flex-shrink-0 rounded-md bg-gray-200 px-2 text-xs text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-40 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20'
              >
                加载
              </button>
            </div>

            {error && <p className='mt-2 text-xs text-red-500'>{error}</p>}
            <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
              字幕来自影库同目录里的字幕文件，可把字幕放在视频旁边自动识别。
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** 把预设样式应用到播放器（ArtPlayer subtitle.style） */
export function applySubtitleStyle(
  player: { subtitle: { style: (name: Record<string, string>) => void } } | null,
  preset: SubtitleStylePreset
) {
  if (!player) return;
  try {
    player.subtitle.style(toSubtitleStyleObject(preset));
  } catch {
    /* 播放器还没建好时忽略 */
  }
}
