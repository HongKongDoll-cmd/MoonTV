'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  buildIntroSkipLabel,
  resolveIntroEnd,
  resolveLearnedIntroEnd,
  shouldShowIntroSkip,
} from '@/lib/intro-skip';

interface IntroSkipButtonProps {
  /**
   * 播放器容器。组件自己从里面取 `video` —— 与 PlaybackNetworkBar 同一套做法，
   * 避免为了一个按钮再让 usePlayEngine 多暴露一个 ref。
   */
  containerRef?: React.RefObject<HTMLElement | null>;
  /**
   * 设置面板里手填的片头时长（秒）。0 = 没填。
   * 手填优先于「记住的」——用户明确设置过的意图不该被自动记忆覆盖。
   */
  configuredIntroTime: number;
  /** 当前这一集的唯一标识（通常是 source+id），用于按集记忆 */
  storageKey: string;
  /** 该集是否已经记住过片头长度（决定按钮要不要提示「已记住」） */
  onLearnedChange?: (learned: boolean) => void;
}

/**
 * 「跳过片头」浮动按钮（4.5.9）
 *
 * 放在播放器右下角浮层里，片头区间内出现、越过就消失。
 * 位置刻意选右下：ArtPlayer 的控制栏在这条边，右下角是原生视频控件
 * （音量/全屏）最少的地方，不会跟它们抢点击。
 */
export function IntroSkipButton({
  containerRef,
  configuredIntroTime,
  storageKey,
  onLearnedChange,
}: IntroSkipButtonProps) {
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState('跳过片头');
  /** 记住的片头长度；0 = 还没记住 */
  const [remembered, setRemembered] = useState(0);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  /**
   * 播放器是 ArtPlayer 异步构造的，容器刚挂上时里面还没有 `video`。
   * 这里轮询一小段直到找到，找到后就停 —— 之后由 video 元素自己的事件驱动。
   */
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const tryResolve = () => {
      if (cancelled) return;
      const el = (containerRef?.current?.querySelector(
        'video'
      ) as HTMLVideoElement) ?? null;
      if (el) {
        setVideo(el);
        if (timer) clearInterval(timer);
        timer = null;
      }
    };
    tryResolve();
    if (!timer) {
      timer = setInterval(tryResolve, 500);
      // 20 秒还没找到就放弃（页面大概已经离开播放态了）
      setTimeout(() => {
        if (timer) clearInterval(timer);
      }, 20_000);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [containerRef]);

  /** 记住的片头长度：换集时换 key，重新读一次 */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const value = raw ? Number(raw) : 0;
      setRemembered(Number.isFinite(value) && value > 0 ? value : 0);
    } catch {
      setRemembered(0);
    }
  }, [storageKey]);

  /**
   * 判断是否该显示。
   *
   * 用 `timeupdate` 而不是 `requestAnimationFrame` 轮询：
   * timeupdate 是浏览器在播放时按秒级节奏主动触发的，不需要自己开定时器
   * （也就不用担心暂停后还在跑）。
   */
  const sync = useCallback(() => {
    if (!video || video.paused) {
      setVisible(false);
      return;
    }
    const introEnd = resolveIntroEnd(
      configuredIntroTime,
      remembered,
      video.duration || 0
    );
    const show = shouldShowIntroSkip(
      video.currentTime || 0,
      introEnd,
      video.duration || 0
    );
    setVisible(show);
    setLabel(buildIntroSkipLabel(introEnd));
  }, [video, configuredIntroTime, remembered]);

  useEffect(() => {
    if (!video) {
      setVisible(false);
      return;
    }
    sync();
    video.addEventListener('timeupdate', sync);
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    video.addEventListener('seeking', sync);
    video.addEventListener('loadedmetadata', sync);
    return () => {
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('play', sync);
      video.removeEventListener('pause', sync);
      video.removeEventListener('seeking', sync);
      video.removeEventListener('loadedmetadata', sync);
    };
  }, [video, sync]);

  const handleClick = useCallback(() => {
    if (!video) return;
    const duration = video.duration || 0;
    const introEnd = resolveIntroEnd(configuredIntroTime, remembered, duration);
    // 记住这次应该跳到哪里：已知的用已知值，未知的用当前位置
    const learned = resolveLearnedIntroEnd(video.currentTime || 0, introEnd, duration);
    const target = learned > 0 ? learned : introEnd;

    if (target > 0) {
      video.currentTime = target;
      setVisible(false);
    }

    if (learned > 0) {
      setRemembered(learned);
      onLearnedChange?.(true);
      try {
        window.localStorage.setItem(storageKey, String(learned));
      } catch {
        /* 隐私模式等场景写不进去，功能降级为「本次有效」，不报错 */
      }
    }
  }, [video, configuredIntroTime, remembered, storageKey, onLearnedChange]);

  if (!visible) return null;

  return (
    <button
      type='button'
      data-testid='intro-skip-button'
      onClick={handleClick}
      className='absolute bottom-14 right-3 z-[70] rounded-full bg-black/65 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500'
      title='记住这一集的片头长度，之后自动跳过'
    >
      {label}
    </button>
  );
}

export default IntroSkipButton;
