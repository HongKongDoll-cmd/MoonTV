import { act, render, screen } from '@testing-library/react';
import type { RefObject } from 'react';

import { IntroSkipButton } from './IntroSkipButton';

/**
 * jsdom 的 video.duration / currentTime / paused 都不可写，
 * 这里造一个可控版本（paused 尤其重要：它是只读 getter，
 * 直接赋值会静默失效，组件就会一直以为「已暂停」）。
 */
function stubVideo(video: HTMLVideoElement, duration: number) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration,
  });
  let time = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  let paused = false;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => paused,
  });
  return {
    seekTo(value: number) {
      time = value;
      act(() => {
        video.dispatchEvent(new Event('timeupdate'));
      });
    },
    setPaused(value: boolean) {
      paused = value;
      act(() => {
        video.dispatchEvent(new Event('pause'));
      });
    },
    get currentTime() {
      return time;
    },
  };
}

const button = () => screen.queryByTestId('intro-skip-button');

/**
 * 组件是从容器里找 `<video>` 的（ArtPlayer 异步构造，容器先挂上）。
 * 所以这里**先**把容器与 video 放进 document，再 render 组件，
 * 避免依赖组件内部的 500ms 轮询。
 */
function setup(options?: {
  duration?: number;
  configuredIntroTime?: number;
  storageKey?: string;
  withVideo?: boolean;
}) {
  const holder = document.createElement('div');
  document.body.appendChild(holder);
  let ctl: ReturnType<typeof stubVideo> | null = null;
  if (options?.withVideo !== false) {
    const video = document.createElement('video');
    holder.appendChild(video);
    ctl = stubVideo(video, options?.duration ?? 2400);
  }
  const ref = { current: holder } as RefObject<HTMLElement | null>;
  const utils = render(
    <IntroSkipButton
      containerRef={ref}
      configuredIntroTime={options?.configuredIntroTime ?? 0}
      storageKey={options?.storageKey ?? 'test:1'}
    />
  );
  return { ctl, holder, ...utils };
}

describe('IntroSkipButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  test('片头区间内显示按钮', () => {
    const { ctl } = setup();
    act(() => ctl?.seekTo(5));
    expect(button()).not.toBeNull();
    expect(button()?.textContent).toBe('跳过片头');
  });

  test('已知片头时长时文案带 mm:ss', () => {
    const { ctl } = setup({ configuredIntroTime: 90 });
    act(() => ctl?.seekTo(5));
    expect(button()?.textContent).toBe('跳过片头 (01:30)');
  });

  test('越过片头后按钮消失', () => {
    const { ctl } = setup({ configuredIntroTime: 90 });
    act(() => ctl?.seekTo(5));
    expect(button()).not.toBeNull();
    act(() => ctl?.seekTo(200));
    expect(button()).toBeNull();
  });

  test('点击后跳到片头结束并记住长度', () => {
    const { ctl } = setup({ configuredIntroTime: 90 });
    act(() => ctl?.seekTo(5));
    act(() => {
      button()?.click();
    });
    expect(ctl?.currentTime).toBe(90);
    expect(button()).toBeNull();
    expect(window.localStorage.getItem('test:1')).toBe('90');
  });

  test('未配置片头时点一下，把当前位置当作片头结束并记住', () => {
    const { ctl } = setup();
    act(() => ctl?.seekTo(96));
    act(() => {
      button()?.click();
    });
    expect(ctl?.currentTime).toBe(96);
    expect(window.localStorage.getItem('test:1')).toBe('96');
  });

  test('记住后按钮文案带上时长（下次进同一集自动知道片头多长）', () => {
    window.localStorage.setItem('test:1', '90');
    const { ctl } = setup();
    act(() => ctl?.seekTo(5));
    expect(button()?.textContent).toBe('跳过片头 (01:30)');
  });

  test('位置太早（点了等于没跳）不记住', () => {
    const { ctl } = setup();
    act(() => ctl?.seekTo(2));
    act(() => {
      button()?.click();
    });
    expect(window.localStorage.getItem('test:1')).toBeNull();
  });

  test('暂停时不显示按钮', () => {
    const { ctl } = setup();
    act(() => ctl?.seekTo(5));
    expect(button()).not.toBeNull();
    act(() => ctl?.setPaused(true));
    expect(button()).toBeNull();
  });

  test('极短的片子不显示按钮', () => {
    const { ctl } = setup({ duration: 60 });
    act(() => ctl?.seekTo(5));
    expect(button()).toBeNull();
  });

  test('播放器还没建好（容器里没有 video）时不渲染也不报错', () => {
    setup({ withVideo: false });
    expect(button()).toBeNull();
  });
});
