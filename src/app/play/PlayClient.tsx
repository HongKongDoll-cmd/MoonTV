/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { buildIntroSkipStorageKey } from '@/lib/intro-skip';
import { readOpenListConfigFromCookie } from '@/lib/openlist';

import AddDownloadModal from '@/components/AddDownloadModal';
import { BackButton } from '@/components/BackButton';
import CacheManager from '@/components/CacheManager';
import DanmakuSelector from '@/components/DanmakuSelector';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

import { HotkeyHelp } from './components/HotkeyHelp';
import { IntroSkipButton } from './components/IntroSkipButton';
import { PlaybackNetworkBar } from './components/PlaybackNetworkBar';
import { ErrorView, LoadingView, VideoLoadingMask } from './components/PlayStatusView';
import { SubtitlePanel } from './components/SubtitlePanel';
import { VideoDetailPanel } from './components/VideoDetailPanel';
import { usePlayEngine } from './usePlayEngine';

/**
 * 播放中顶部操作层淡出前的空闲时长（毫秒）。
 *
 * 太短会让用户刚点一下就消失，太长又挡画面；2.5s 与主流播放器一致。
 */
const PLAYER_CONTROLS_IDLE_MS = 2500;

/**
 * 播放页客户端组件。
 *
 * 仅负责：调用 {@link usePlayEngine} 获取状态/回调，并按视图分层渲染。
 * 加载、错误、视频遮罩、详情面板等均已拆分为独立展示组件。
 */
export default function PlayClient() {
  const router = useRouter();
  const [showAddDownload, setShowAddDownload] = useState(false);
  // 影库地址（个人配置存 cookie，服务端不下发地址）：只用来判断播放地址
  // 是否与影库同源 = 走服务器中转。站点级配置拿不到地址，靠 URL 特征兜底。
  const [libraryHost, setLibraryHost] = useState<string | null>(null);
  useEffect(() => {
    setLibraryHost(readOpenListConfigFromCookie()?.baseUrl ?? null);
  }, []);

  /**
   * 播放中自动淡出顶部操作层（4.6.4）。
   *
   * 4.6.3 把返回按钮、标题、字幕面板、快捷键帮助嵌进了播放器右上角，
   * 但它们常驻会一直挡着画面。这里按播放器的通行交互做：
   * 播放中且鼠标空闲 2.5s → 淡出；移动鼠标 / 触摸 / seek → 立刻回来；
   * 暂停、加载中、弹幕选择器或缓存面板打开时始终显示（那些时候用户正要操作）。
   *
   * ⚠️ video 元素是 ArtPlayer **异步**创建的，所以用轮询等它出现再绑事件
   * （与 IntroSkipButton 同一套做法），不能假设 effect 跑完时 video 已在。
   */
  const [controlsVisible, setControlsVisible] = useState(true);
  useEffect(() => {
    let video: HTMLVideoElement | null = null;
    let idleTimer: number | null = null;
    let pollTimer: number | null = null;
    let lastWakeAt = 0;

    const clearIdle = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const scheduleIdle = () => {
      clearIdle();
      idleTimer = window.setTimeout(() => {
        if (video && !video.paused) setControlsVisible(false);
      }, PLAYER_CONTROLS_IDLE_MS);
    };

    const wake = () => {
      // 节流：鼠标移动事件频率很高，没必要每次都重置定时器
      const now = Date.now();
      if (now - lastWakeAt < 400) return;
      lastWakeAt = now;
      setControlsVisible(true);
      scheduleIdle();
    };

    const onPause = () => {
      setControlsVisible(true);
      clearIdle();
    };

    const onPlay = () => {
      setControlsVisible(true);
      scheduleIdle();
    };

    const bindVideo = (): boolean => {
      video = artRef.current?.querySelector<HTMLVideoElement>('video') ?? null;
      if (!video) return false;
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('seeking', wake);
      return true;
    };

    pollTimer = window.setInterval(() => {
      if (bindVideo()) {
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 500);

    const container = artRef.current;
    container?.addEventListener('mousemove', wake);
    container?.addEventListener('touchstart', wake);

    return () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      clearIdle();
      video?.removeEventListener('play', onPlay);
      video?.removeEventListener('pause', onPause);
      video?.removeEventListener('seeking', wake);
      container?.removeEventListener('mousemove', wake);
      container?.removeEventListener('touchstart', wake);
    };
  }, []);

  const {
    // 加载 / 错误
    loading,
    loadingStage,
    loadingMessage,
    error,
    // 视频与元数据
    detail,
    totalEpisodes,
    videoTitle,
    videoYear,
    videoDoubanId,
    videoCover,
    currentSource,
    currentId,
    searchTitle,
    currentEpisodeIndex,
    videoUrl,
    skipConfig,
    // 字幕（4.5.7）
    subtitleTracks,
    currentVideoName,
    activeSubtitleUrl,
    subtitleStyleId,
    switchSubtitle,
    changeSubtitleStyle,
    // 播放器
    artRef,
    isVideoLoading,
    videoLoadingStage,
    setLoading,
    setIsVideoLoading,
    setVideoLoadingStage,
    // 源 / 换源
    availableSources,
    sourceSearchLoading,
    sourceSearchError,
    precomputedVideoInfo,
    preferBestSource,
    handleSourceChange,
    handleEpisodeChange,
    // 弹幕
    showDanmakuSelector,
    isDanmakuLoading,
    handleDanmakuSelect,
    handleDanmakuClose,
    // 缓存管理
    showCacheManager,
    setShowCacheManager,
    // 收藏 / 追更
    favorited,
    following,
    handleToggleFavorite,
    handleToggleFollowing,
  } = usePlayEngine();

  // 这些场景下强制显示顶部操作层：加载中用户正要等结果，
  // 弹幕选择器 / 缓存面板打开时正要操作，不能这时候淡出。
  const overlayVisible =
    controlsVisible ||
    isVideoLoading ||
    showDanmakuSelector ||
    showCacheManager;

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        {/* 加载态也留一个返回入口：搜错片/等太久不想等时能直接退出去。
            用绝对定位覆盖，避免给整屏的加载视图额外撑出滚动条。 */}
        <div className='relative'>
          <div className='absolute left-3 top-3 z-10 md:left-[calc(var(--moontv-sidenav-w)+1.5rem)] md:top-4'>
            <BackButton showLabel />
          </div>
          <LoadingView stage={loadingStage} message={loadingMessage} />
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <ErrorView
          message={error}
          videoTitle={videoTitle}
          onPrimary={() =>
            videoTitle
              ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
              : router.back()
          }
          onRetry={() => window.location.reload()}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      {/* 4.6.4：左侧留位必须保留。侧边栏是 `fixed left-0 z-50` 的**浮层**
          （见 globals.css 的 .moontv-sidenav），内容区不预留 padding 就会被它
          盖住左侧 144px —— 4.6.3 曾把这里改成 md:px-6，播放器左缘顶到屏幕边，
          表现为「播放器左侧与侧边栏重叠」。
          "横向全宽"指的是占满侧边栏以外的空间，不是盖到侧边栏上去。 */}
      <div className='moontv-sidenav-content flex flex-col px-0 md:pl-[calc(var(--moontv-sidenav-w)+1.5rem)] md:pr-6'>
        {/* 播放器和选集 */}
        <div>
          <div className='grid lg:h-[500px] xl:h-[650px] 2xl:h-[750px] grid-cols-1 md:grid-cols-4 md:gap-0'>
            {/* 播放器 */}
            <div className='h-full border-0 md:border-t md:border-b md:border-l md:border-white/0 md:dark:border-white/30 md:col-span-3'>
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full overflow-hidden shadow-lg'
                ></div>

                {/* 4.6.3 返回按钮与标题嵌入播放器。
                    原来它们在播放器**外面**的顶部操作栏，播放器一全屏就跟着消失，
                    用户想退出全屏只能靠 Esc/浏览器手势。放在 artRef 容器内，
                    `fixed` 会以 fullscreen 元素为包含块，全屏时依然可见。
                    字幕面板与快捷键帮助一并搬到这里：它们原本也在那条操作栏上。
                    4.6.4：播放中且鼠标空闲时整层淡出（overlayVisible），
                    移动鼠标 / 触摸 / seek 立刻回来，暂停时常驻。 */}
                <div
                  className={`pointer-events-none absolute left-0 right-0 top-0 z-[600] flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-2 transition-opacity duration-300 ${
                    overlayVisible
                      ? 'opacity-100'
                      : 'pointer-events-none opacity-0'
                  }`}
                >
                  <div className='pointer-events-auto flex min-w-0 items-center gap-3'>
                    <BackButton showLabel />
                    {videoTitle && (
                      <span className='truncate text-sm text-white/90'>
                        {videoTitle}
                        {totalEpisodes > 1 &&
                          ` · 第 ${currentEpisodeIndex + 1} 集`}
                      </span>
                    )}
                  </div>
                  <div className='pointer-events-auto ml-auto flex shrink-0 items-center gap-2'>
                    <SubtitlePanel
                      tracks={subtitleTracks}
                      videoName={currentVideoName}
                      activeUrl={activeSubtitleUrl}
                      onSwitch={switchSubtitle}
                      onStyleChange={changeSubtitleStyle}
                      initialPresetId={subtitleStyleId}
                    />
                    <HotkeyHelp />
                  </div>
                </div>

                {/* 弹幕选择器 */}
                {showDanmakuSelector && (
                  <DanmakuSelector
                    videoTitle={videoTitle}
                    isVisible={showDanmakuSelector}
                    currentEpisode={currentEpisodeIndex + 1}
                    currentEpisodeTitle={
                      detail?.episodes_titles?.[currentEpisodeIndex]
                    }
                    onSelect={handleDanmakuSelect}
                    onClose={handleDanmakuClose}
                  />
                )}

                {/* 跳过片头（4.5.9）：只在片头区间出现，越过即消失。
                    记 key 用 source+id，换源/换集互不干扰。 */}
                <IntroSkipButton
                  containerRef={artRef}
                  configuredIntroTime={skipConfig.intro_time}
                  storageKey={buildIntroSkipStorageKey(
                    currentSource,
                    `${currentId}#${currentEpisodeIndex}`
                  )}
                />

                {/* 换源加载蒙层 */}
                <VideoLoadingMask
                  visible={isVideoLoading}
                  stage={videoLoadingStage}
                />

                {/* 弹幕加载提示 */}
                {/* 弹幕加载提示。top-16 是为了避开上面的返回/标题操作层 ——
                    两者都在顶部，重叠会互相挡住。 */}
                {isDanmakuLoading && (
                  <div className='absolute top-16 left-4 right-4 z-[400] flex justify-center'>
                    <div className='bg-gray-800/90 text-white px-4 py-2 rounded-lg shadow-lg'>
                      正在自动加载弹幕...
                    </div>
                  </div>
                )}

                {/* 4.6.3 缓存管理弹窗挂进播放器容器。
                    它原来是 PageLayout 层级的 fixed 元素，播放器全屏时被
                    fullscreen 元素整个盖住，用户在全屏里点不开缓存管理。
                    移到这里后 `fixed` 以播放器为包含块，全屏时照常弹出。 */}
                <CacheManager
                  isOpen={showCacheManager}
                  onClose={() => setShowCacheManager(false)}
                />
              </div>
            </div>

            {/* 选集和换源 */}
            <div className='h-[300px] lg:h-full md:overflow-hidden md:col-span-1'>
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                preferBestSource={preferBestSource}
                setLoading={setLoading}
                setIsVideoLoading={setIsVideoLoading}
                setVideoLoadingStage={setVideoLoadingStage}
              />
            </div>
          </div>
        </div>

        {/* 链路诊断：只给影库来源看。网盘视频不走 hls.js，播放慢的时候
            用户没法判断是服务器中转慢还是自己带宽不够，这里摆出来。
            （普通采集站是 m3u8，由 hls.js 接管，这套指标不适用） */}
        {(currentSource === 'openlist' || currentSource === 'emby') && (
          <PlaybackNetworkBar
            videoUrl={videoUrl}
            libraryHost={libraryHost}
            containerRef={artRef}
          />
        )}

        {/* 详情展示 */}
        <VideoDetailPanel
          videoTitle={videoTitle}
          videoYear={videoYear}
          totalEpisodes={totalEpisodes}
          currentEpisodeIndex={currentEpisodeIndex}
          detail={detail}
          videoCover={videoCover}
          favorited={favorited}
          following={following}
          onToggleFavorite={handleToggleFavorite}
          onToggleFollowing={handleToggleFollowing}
          videoUrl={videoUrl}
          videoDoubanId={videoDoubanId}
          currentSource={currentSource}
          currentId={currentId}
          onDownload={() => setShowAddDownload(true)}
        />
      </div>

      {/* 添加下载弹窗 */}
      <AddDownloadModal
        isOpen={showAddDownload}
        onClose={() => setShowAddDownload(false)}
        onAddTask={(config) => {
          // 触发自定义事件，通知导航栏的下载管理器
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('addDownloadTask', { detail: config })
            );
          }
          setShowAddDownload(false);
        }}
        initialUrl={videoUrl || ''}
        episodes={(detail?.episodes || []).map((url, i) => ({
          url,
          title: `${videoTitle}_${detail?.episodes_titles?.[i] || `第${i + 1}集`}`,
          label: detail?.episodes_titles?.[i] || `第${i + 1}集`,
        }))}
        currentEpisodeIndex={currentEpisodeIndex}
        initialTitle={`${videoTitle}${
          totalEpisodes > 1
            ? `_${detail?.episodes_titles?.[currentEpisodeIndex] || `第${currentEpisodeIndex + 1}集`}`
            : ''
        }`}
        skipConfig={skipConfig}
      />
    </PageLayout>
  );
}
