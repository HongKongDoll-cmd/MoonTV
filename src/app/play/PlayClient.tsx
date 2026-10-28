/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { buildIntroSkipStorageKey } from '@/lib/intro-skip';
import { readOpenListConfigFromCookie } from '@/lib/openlist';
import {
  hasSeenPlayHelpTip,
  markPlayHelpTipSeen,
  PLAY_HELP_OPEN_EVENT,
} from '@/lib/play-help';
import { playerNotices, showPlayerNotice } from '@/lib/player-notices';

import AddDownloadModal from '@/components/AddDownloadModal';
import { BackButton } from '@/components/BackButton';
import CacheManager from '@/components/CacheManager';
import DanmakuSelector from '@/components/DanmakuSelector';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

import { PlayHelpButton, PlayHelpDialog } from './components/HotkeyHelp';
import { IntroSkipButton } from './components/IntroSkipButton';
import { PlaybackNetworkBar } from './components/PlaybackNetworkBar';
import PlayerNoticeStack from './components/PlayerNoticeStack';
import { ErrorView, LoadingView, VideoLoadingMask } from './components/PlayStatusView';
import { SubtitlePanel } from './components/SubtitlePanel';
import { VideoDetailPanel } from './components/VideoDetailPanel';
import { usePlayEngine } from './usePlayEngine';

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
   * 顶部操作层（返回/标题/字幕/快捷键）的显隐 —— **跟随播放器控制栏**（4.6.5）。
   *
   * 4.6.4 曾自己维护一套"鼠标空闲 2.5s 就淡出"的计时器，结果和控制栏
   * （含进度条）各按各的节奏走：会出现"控制栏还在但返回按钮已经没了"、
   * 或者反之的割裂感，暂停/悬停控制栏时的行为也对不齐。
   *
   * ArtPlayer 把控制栏的显隐状态写在 `$player` 的 `art-hover` class 上：
   *   - 播放器内移动鼠标 / 点击 → 加上 art-hover（显示）
   *   - 播放中空闲超过 CONTROL_HIDE_TIME(3s) → 移除（隐藏）
   *   - 暂停中、鼠标悬在底部控制栏上 → 不移除（常驻）
   * 所以这里用 MutationObserver 观察这个 class，让操作层与控制栏**完全同步**，
   * 不再自建计时器，也不必去猜它的时长。
   *
   * ⚠️ 播放器是异步构造的，用轮询等 `$player` 出现再 observe
   * （与 IntroSkipButton 同一套做法）；观测范围限定 `attributeFilter: ['class']`，
   * 否则播放进度的 style 变化会把回调刷爆。
   */
  const [controlsVisible, setControlsVisible] = useState(true);
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let pollTimer: number | null = null;

    const start = (): boolean => {
      const container = artRef.current;
      if (!container) return false;

      const readHover = () => {
        // 不假设 art-hover 具体挂在哪个元素上，容器内有人带这个 class 就算显示
        setControlsVisible(!!container.querySelector('.art-hover'));
      };

      readHover();
      observer = new MutationObserver(readHover);
      observer.observe(container, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      return true;
    };

    if (!start()) {
      pollTimer = window.setInterval(() => {
        if (start() && pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 500);
    }

    return () => {
      observer?.disconnect();
      if (pollTimer !== null) window.clearInterval(pollTimer);
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

  /**
   * 弹窗（弹幕选择器 / 缓存管理）的挂载目标（4.6.5）。
   *
   * 为什么必须动态切：**Fullscreen API 会把 fullscreen 元素提升到 top layer
   * 并盖住整个视口**，此时挂在 document.body 下的任何 fixed 弹窗都会被它
   * 遮住 —— 只有 fullscreen 元素的**后代**才能显示在上面。
   * 而 ArtPlayer 全屏的目标是 `template.$player`（播放器模板根节点），
   * 不是我们写 JSX 的那个容器，所以"把弹窗放进播放器外层 div"并不够
   * （4.6.3 正是这么做的，用户实测全屏时依然看不到）。
   *
   * 这里监听 fullscreenchange：
   *   - 全屏中 → portal 到 `document.fullscreenElement`（即 $player）
   *   - 否则   → portal 到 body（与改动前一致）
   */
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const update = () => {
      const el = document.fullscreenElement ?? document.body;
      setPortalTarget(el as HTMLElement);
      setIsFullscreen(!!document.fullscreenElement);
    };
    update();
    document.addEventListener('fullscreenchange', update);
    // Safari 旧前缀
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);

  /**
   * 「操作说明」弹层（4.7.2）。
   *
   * 两个入口：播放器顶部的按钮、以及设置面板里的开关。后者在
   * `usePlayEngine` 内部，没有直连的 props 通道，用窗口事件通知
   * （见 lib/play-help.ts）。
   */
  const [showPlayHelp, setShowPlayHelp] = useState(false);
  useEffect(() => {
    const open = () => setShowPlayHelp(true);
    window.addEventListener(PLAY_HELP_OPEN_EVENT, open);
    return () => window.removeEventListener(PLAY_HELP_OPEN_EVENT, open);
  }, []);

  /**
   * 首次进入播放页提示一次「操作说明」入口（4.7.2）。
   *
   * 只在从没看过时提示：播放页是沉浸场景，每次都弹等于骚扰。
   * 延迟 1.2s 是因为播放器构造、首个分片加载都在头几秒，
   * 立刻弹会和「缓冲中」这类提示挤在一起。
   */
  /**
   * 弹幕加载态并入堆叠提示（4.7.2）。
   *
   * 原来它是画面顶部居中的一条独立提示，和右上角的堆叠提示会**重叠**。
   * 现在统一走队列：用固定 key 让它就地更新（切集时只改文本、不刷屏），
   * 加载结束立刻 dismiss —— 所以 duration 给得很长，靠 dismiss 收尾，
   * 避免长加载时提示提前消失。
   */
  useEffect(() => {
    if (isDanmakuLoading) {
      showPlayerNotice('正在加载弹幕…', {
        key: 'danmaku-loading',
        duration: 120000,
      });
    } else {
      playerNotices.dismiss('danmaku-loading');
    }
  }, [isDanmakuLoading]);

  useEffect(() => {
    if (hasSeenPlayHelpTip()) return;
    const timer = window.setTimeout(() => {
      showPlayerNotice('点右上角「操作说明」可查看手势与快捷键', {
        key: 'play-help-tip',
        duration: 6000,
      });
      markPlayHelpTipSeen();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

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
              {/* 4.6.6 移动端：
                  竖屏 —— 原来固定 h-[300px]，16:9 片源在 390px 宽的手机上实际
                  画面只有 219px，上下各留 40px 黑边。改成 aspect-video 自适应，
                  黑边消失、页面更紧凑（画面尺寸不变）。
                  横屏 —— 用 mobile-landscape 断点（orientation: landscape 且
                  max-height:700px）把播放器 fixed 铺满视口，进入沉浸态；
                  转回竖屏自动恢复。桌面端不受影响（高度通常 > 700px）。 */}
              <div className='relative w-full aspect-video lg:aspect-auto lg:h-full mobile-landscape:fixed mobile-landscape:inset-0 mobile-landscape:z-[700] mobile-landscape:aspect-auto mobile-landscape:h-[100dvh] mobile-landscape:bg-black'>
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
                    {/* 手机上也有说明（触摸操作那一段），只在超窄屏收起文字 */}
                    <PlayHelpButton onClick={() => setShowPlayHelp(true)} />
                  </div>
                </div>

                {/* 弹幕选择器（4.6.5 改走 portal，全屏时才能显示在播放器上方） */}
                {showDanmakuSelector &&
                  portalTarget &&
                  createPortal(
                    <DanmakuSelector
                      videoTitle={videoTitle}
                      isVisible={showDanmakuSelector}
                      currentEpisode={currentEpisodeIndex + 1}
                      currentEpisodeTitle={
                        detail?.episodes_titles?.[currentEpisodeIndex]
                      }
                      onSelect={handleDanmakuSelect}
                      onClose={handleDanmakuClose}
                    />,
                    portalTarget
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

                {/* 换源加载蒙层。
                    全屏时外层容器不在 fullscreen 里，absolute 遮罩会跟着消失，
                    用户换源/优选时看不到任何提示。这里全屏中改走 portal。 */}
                {isFullscreen && portalTarget
                  ? createPortal(
                      <VideoLoadingMask
                        visible={isVideoLoading}
                        stage={videoLoadingStage}
                      />,
                      portalTarget
                    )
                  : (
                    <VideoLoadingMask
                      visible={isVideoLoading}
                      stage={videoLoadingStage}
                    />
                  )}

                {/* 播放器右上角堆叠提示（4.7.2）。
                    替代原来单条 `art.notice.show`：那个会被后一条直接覆盖，
                    而本项目不少提示是连续发生的（降档 → 切源 → 已恢复），
                    用户根本来不及看。全屏时同样要 portal，否则会被 top layer 遮住。 */}
                {isFullscreen && portalTarget
                  ? createPortal(
                      <PlayerNoticeStack fullscreen />,
                      portalTarget
                    )
                  : <PlayerNoticeStack fullscreen={false} />}

                {/* 操作说明弹层（4.7.2）。全屏时同样要 portal，
                    否则会被 top layer 整个盖住、点了没反应。 */}
                {isFullscreen && portalTarget
                  ? createPortal(
                      <PlayHelpDialog
                        open={showPlayHelp}
                        onClose={() => setShowPlayHelp(false)}
                      />,
                      portalTarget
                    )
                  : (
                    <PlayHelpDialog
                      open={showPlayHelp}
                      onClose={() => setShowPlayHelp(false)}
                    />
                  )}


                {/* 4.6.3 曾把它移进播放器外层容器，但 ArtPlayer 全屏的目标是
                    template.$player，那个容器并不在 fullscreen 里，用户实测
                    全屏时依然看不到。4.6.5 改为 portal 到 fullscreenElement。 */}
                {portalTarget &&
                  createPortal(
                    <CacheManager
                      isOpen={showCacheManager}
                      onClose={() => setShowCacheManager(false)}
                    />,
                    portalTarget
                  )}
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
