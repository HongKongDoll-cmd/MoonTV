import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { PlaybackNetworkBar } from './PlaybackNetworkBar';

/** jsdom 的 video.buffered 是空 TimeRanges，这里造一个可控的版本 */
function stubBuffered(video: HTMLVideoElement, ranges: Array<[number, number]>) {
  Object.defineProperty(video, 'buffered', {
    configurable: true,
    get: () => ({
      length: ranges.length,
      start: (i: number) => ranges[i][0],
      end: (i: number) => ranges[i][1],
    }),
  });
}

function stubTime(video: HTMLVideoElement, value: number) {
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => value,
  });
}

function Wrapper({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={ref}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video />
      </div>
      <PlaybackNetworkBar videoUrl={url} containerRef={ref} />
    </>
  );
}

const RELAY_URL = 'http://127.0.0.1:5245/d/电影/E01.mkv?sign=abc';
const DIRECT_URL = 'https://cdn.example.com/xyz/E01.mkv?auth=1';

async function flush(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('PlaybackNetworkBar', () => {
  test('中转地址显示「经影库服务器中转」', async () => {
    render(<Wrapper url={RELAY_URL} />);
    expect(await screen.findByText('经影库服务器中转')).toBeDefined();
    expect(screen.getByText('播放链路')).toBeDefined();
  });

  test('网盘直链显示「网盘直连」', async () => {
    render(<Wrapper url={DIRECT_URL} />);
    expect(await screen.findByText('网盘直连')).toBeDefined();
  });

  test('拿不到地址时不渲染（不给普通源添乱）', () => {
    render(<Wrapper url='' />);
    expect(screen.queryByText('播放链路')).toBeNull();
  });

  test('采样后显示缓冲水位', async () => {
    render(<Wrapper url={RELAY_URL} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    stubTime(video, 10);
    stubBuffered(video, [[0, 42]]);
    Object.defineProperty(video, 'paused', { configurable: true, get: () => true });

    // 等组件轮询找到 video 并完成一次采样
    await flush(1600);

    expect(screen.getByText('缓冲 32 秒')).toBeDefined();
    // 暂停时不更新补速，保持占位符
    expect(screen.getByText('补速 —')).toBeDefined();
    expect(screen.getByText('未卡顿')).toBeDefined();
  });

  test('waiting 事件累计卡顿次数', async () => {
    render(<Wrapper url={RELAY_URL} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    stubTime(video, 0);
    stubBuffered(video, [[0, 10]]);
    Object.defineProperty(video, 'paused', { configurable: true, get: () => true });

    await flush(600);
    await act(async () => {
      video.dispatchEvent(new Event('waiting'));
      video.dispatchEvent(new Event('waiting'));
    });

    expect(screen.getByText('卡顿 2 次')).toBeDefined();
  });
});
