/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import { useEffect, useRef, useState } from 'react';

import {
  type BufferHealth,
  BUFFER_HEALTH_LABELS,
  classifyBufferHealth,
  classifyPlaybackLink,
  formatBufferAhead,
  formatRefillRate,
  formatStallCount,
  PLAYBACK_LINK_LABELS,
} from '@/lib/playback-network';

/**
 * 播放页的链路诊断条。
 *
 * 只挂在影库来源的播放上：网盘视频是单文件、不走 hls.js，播放慢的时候
 * 用户完全不知道是「影库服务器中转太慢」还是「自己带宽不够」，
 * 这里把链路类型 / 缓冲水位 / 补缓冲倍率 / 卡顿次数摆出来。
 *
 * 采样状态**刻意放在本组件内部**：每秒更新一次缓冲水位，如果提到播放页
 * 顶层 state，整棵播放页树会跟着每秒重渲一次，反而更卡。
 */

/** 采样间隔（毫秒） */
const SAMPLE_INTERVAL = 1000;
/** 播放器挂载可能晚于本组件，轮询找 video 元素 */
const FIND_VIDEO_INTERVAL = 200;
const FIND_VIDEO_MAX_TRIES = 40;
/** 播放位置跳变超过这个秒数算 seek/切集，速率样本作废 */
const SEEK_JUMP_SECONDS = 3;

interface PlaybackNetworkBarProps {
  /** 当前播放地址 */
  videoUrl: string;
  /** 影库地址（用于判断是否同源 = 中转）；拿不到就靠 URL 特征判定 */
  libraryHost?: string | null;
  /** ArtPlayer 的挂载容器（video 元素在里面） */
  containerRef?: React.RefObject<HTMLElement | null>;
}

interface Sample {
  /** 缓冲末端（秒） */
  end: number;
  /** 播放位置（秒） */
  time: number;
  /** 采样时刻（毫秒） */
  at: number;
}

const HEALTH_DOT_CLASS: Record<BufferHealth, string> = {
  good: 'bg-green-500',
  tight: 'bg-amber-500',
  starving: 'bg-red-500',
  unknown: 'bg-gray-400',
};

const HEALTH_TEXT_CLASS: Record<BufferHealth, string> = {
  good: 'text-green-600 dark:text-green-400',
  tight: 'text-amber-600 dark:text-amber-400',
  starving: 'text-red-600 dark:text-red-400',
  unknown: 'text-gray-500 dark:text-gray-400',
};

export function PlaybackNetworkBar({
  videoUrl,
  libraryHost,
  containerRef,
}: PlaybackNetworkBarProps) {
  const [bufferAhead, setBufferAhead] = useState<number | null>(null);
  const [refillRate, setRefillRate] = useState<number | null>(null);
  const [stallCount, setStallCount] = useState(0);
  const sampleRef = useRef<Sample | null>(null);

  // 切集/换源 = 新的一路流，旧样本不能用来算速率
  useEffect(() => {
    sampleRef.current = null;
    setBufferAhead(null);
    setRefillRate(null);
    setStallCount(0);
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) return;

    let video: HTMLVideoElement | null = null;
    let findTimer: ReturnType<typeof setTimeout> | null = null;
    let sampleTimer: ReturnType<typeof setInterval> | null = null;
    let tries = 0;
    let disposed = false;

    const onWaiting = () => {
      if (!disposed) setStallCount((n) => n + 1);
    };

    const readSample = (): Sample | null => {
      if (!video) return null;
      const time = video.currentTime;
      let end = 0;
      for (let i = 0; i < video.buffered.length; i += 1) {
        const start = video.buffered.start(i);
        const stop = video.buffered.end(i);
        if (time >= start - 0.5 && time <= stop) {
          end = stop;
          break;
        }
      }
      return { end, time, at: Date.now() };
    };

    const tick = () => {
      if (!video) return;
      const current = readSample();
      if (!current) return;

      setBufferAhead(Math.max(0, current.end - current.time));

      const prev = sampleRef.current;
      // 暂停时缓冲本来就不该推进，速率保持上一次的值，别误报成 0×
      if (prev && !video.paused) {
        const elapsed = (current.at - prev.at) / 1000;
        const jumped = Math.abs(current.time - prev.time) > SEEK_JUMP_SECONDS;
        if (elapsed > 0.5 && !jumped) {
          // 净补进来的内容 = 缓冲末端增量 + 这段时间播掉的
          const produced =
            current.end - prev.end + (current.time - prev.time);
          const rate = produced / elapsed;
          if (Number.isFinite(rate)) {
            setRefillRate((old) => (old == null ? rate : old * 0.5 + rate * 0.5));
          }
        }
      }
      sampleRef.current = current;
    };

    const bind = () => {
      video?.addEventListener('waiting', onWaiting);
      sampleTimer = setInterval(tick, SAMPLE_INTERVAL);
      tick();
    };

    const findVideo = () => {
      if (disposed) return;
      const container = containerRef?.current;
      video = (container?.querySelector('video') as HTMLVideoElement) ?? null;
      if (video) {
        bind();
        return;
      }
      tries += 1;
      if (tries < FIND_VIDEO_MAX_TRIES) {
        findTimer = setTimeout(findVideo, FIND_VIDEO_INTERVAL);
      }
    };

    findVideo();

    return () => {
      disposed = true;
      if (findTimer) clearTimeout(findTimer);
      if (sampleTimer) clearInterval(sampleTimer);
      video?.removeEventListener('waiting', onWaiting);
    };
  }, [videoUrl, containerRef]);

  const linkKind = classifyPlaybackLink(videoUrl, libraryHost);
  if (linkKind === 'unknown') return null;

  const health = classifyBufferHealth({ bufferAhead, refillRate });

  return (
    <div
      className='mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 text-xs text-gray-600 dark:text-gray-300 lg:px-0'
      data-testid='playback-network-bar'
    >
      <span className='font-medium text-gray-700 dark:text-gray-200'>
        播放链路
      </span>
      <span
        className={`rounded px-1.5 py-[1px] ${
          linkKind === 'relay'
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            : 'bg-green-500/15 text-green-700 dark:text-green-300'
        }`}
        title={
          linkKind === 'relay'
            ? '视频数据要经过影库服务器转发一次，速度上限是影库服务器的上行带宽'
            : '浏览器直连网盘取数据，速度取决于你自己的带宽与网盘限速'
        }
      >
        {PLAYBACK_LINK_LABELS[linkKind]}
      </span>
      <span className='flex items-center gap-1'>
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT_CLASS[health]}`}
        />
        <span className={HEALTH_TEXT_CLASS[health]}>
          {BUFFER_HEALTH_LABELS[health]}
        </span>
      </span>
      <span className='text-gray-500 dark:text-gray-400'>
        缓冲 {formatBufferAhead(bufferAhead)}
      </span>
      <span className='text-gray-500 dark:text-gray-400'>
        补速 {formatRefillRate(refillRate)}
      </span>
      <span className='text-gray-500 dark:text-gray-400'>
        {formatStallCount(stallCount)}
      </span>
    </div>
  );
}
