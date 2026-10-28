/**
 * 「操作说明」弹层的唤起通道（4.7.2）。
 *
 * 为什么要一个事件通道：说明弹层渲染在 `PlayClient`（React 树上层），
 * 而触发入口之一在 **ArtPlayer 的设置面板**（`usePlayEngine` 内部）。
 * 两者之间没有直连的 props 通道，硬塞一个回调要穿透好几层，
 * 而这里只有「打开」这一个动作，用一次性的窗口事件最轻。
 *
 * 弹层本体见 `app/play/components/HotkeyHelp.tsx` 的 `PlayHelpDialog`。
 */

export const PLAY_HELP_OPEN_EVENT = 'moontv:play-help-open';

/** 请求打开「操作说明」（设置面板入口用） */
export function requestPlayHelp(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PLAY_HELP_OPEN_EVENT));
}

/**
 * 首次进入播放页的引导提示是否已经展示过。
 *
 * 只在「从没看过」时提示一次：播放页是沉浸场景，每次都弹等于骚扰。
 * 用 localStorage 记忆而不是 sessionStorage —— 用户换设备/清缓存后
 * 再看一次说明是合理的，但同一个浏览器里不必重复。
 */
export const PLAY_HELP_SEEN_KEY = 'moontv_play_help_seen_v1';

export function hasSeenPlayHelpTip(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PLAY_HELP_SEEN_KEY) === '1';
  } catch {
    // 隐私模式读不到 → 当作已看过，避免每次进播放页都提示
    return true;
  }
}

export function markPlayHelpTipSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLAY_HELP_SEEN_KEY, '1');
  } catch {
    // 写不进去也无所谓，只是下次还会提示一次
  }
}
