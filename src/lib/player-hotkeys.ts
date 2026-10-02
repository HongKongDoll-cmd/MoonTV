/**
 * 播放器快捷键。
 *
 * 之前 ArtPlayer 的 `hotkey` 是关掉的（`hotkey: false`），键盘完全没反应。
 * 4.5.6 起打开，并在这里把「给用户看的说明表」与 ArtPlayer 的真实行为对齐。
 *
 * ⚠️ **两个踩过的坑，写在这里免得再犯**：
 *
 * 1. ArtPlayer 5 的 `option.hotkey` **只接受 boolean**。传对象会直接抛
 *    `'option.hotkey' require 'boolean' type, but got 'object'`，
 *    **播放器创建失败、整页卡在「播放器初始化失败」**。各键的细粒度行为
 *    是内置写死的，不通过 option 配。
 * 2. 内置热键只有 6 个（见下方实测清单），**没有 F / M / Shift 加速**，
 *    单击与双击是鼠标事件而不是键盘事件。说明表照实写，别凭空多写。
 */

/** 是否开启播放器热键（ArtPlayer 的 option.hotkey，boolean） */
export const PLAYER_HOTKEY_ENABLED = true;

/** 快退快进步长（秒），取自 ArtPlayer 5.3 内部常量 SEEK_STEP */
export const PLAYER_SEEK_STEP = 5;

export interface PlayerHotkey {
  /** 按键显示文本 */
  keys: string;
  /** 作用说明 */
  action: string;
}

/**
 * 快捷键清单。
 *
 * 前六条来自 ArtPlayer 5.3 内置实现（`artplayer.mjs` 里 `hotkey.add(...)`
 * 与 click/dblclick 分支），最后一条是它不监听、需自行处理的场景提示。
 */
export const PLAYER_HOTKEYS: PlayerHotkey[] = [
  { keys: '空格', action: '播放 / 暂停' },
  { keys: '← / →', action: `快退 / 快进 ${PLAYER_SEEK_STEP} 秒` },
  { keys: '↑ / ↓', action: '增大 / 减小音量' },
  { keys: 'Esc', action: '退出网页全屏' },
  { keys: '单击画面', action: '播放 / 暂停' },
  { keys: '双击画面', action: '进入 / 退出全屏' },
];
