import {
  PLAYER_HOTKEY_ENABLED,
  PLAYER_HOTKEYS,
  PLAYER_SEEK_STEP,
} from '../player-hotkeys';

describe('PLAYER_HOTKEY_ENABLED', () => {
  test('必须是 boolean（ArtPlayer 5 的 option.hotkey 只接受 boolean）', () => {
    // 传对象会抛 "'option.hotkey' require 'boolean' type"，
    // 直接导致播放器创建失败、页面卡在「播放器初始化失败」
    expect(typeof PLAYER_HOTKEY_ENABLED).toBe('boolean');
    expect(PLAYER_HOTKEY_ENABLED).toBe(true);
  });
});

describe('PLAYER_SEEK_STEP', () => {
  test('与 ArtPlayer 5.3 内置步长一致（5 秒）', () => {
    expect(PLAYER_SEEK_STEP).toBe(5);
  });
});

describe('PLAYER_HOTKEYS', () => {
  test('每条都有按键与说明', () => {
    for (const item of PLAYER_HOTKEYS) {
      expect(typeof item.keys).toBe('string');
      expect(item.keys.length).toBeGreaterThan(0);
      expect(typeof item.action).toBe('string');
      expect(item.action.length).toBeGreaterThan(0);
    }
  });

  test('包含 ArtPlayer 内置的六个热键', () => {
    const keys = PLAYER_HOTKEYS.map((i) => i.keys);
    expect(keys).toEqual(
      expect.arrayContaining(['空格', '← / →', '↑ / ↓', 'Esc', '单击画面', '双击画面'])
    );
  });

  test('不写 ArtPlayer 并不支持的键（避免说明与实现对不上）', () => {
    const text = PLAYER_HOTKEYS.map((i) => i.keys).join(' ');
    // F=画中画、M=静音、Shift 加速在 5.3 内置里都不存在
    expect(text).not.toMatch(/^F$/);
    expect(text).not.toMatch(/\bShift\b/);
    expect(text.includes('静音')).toBe(false);
    expect(text.includes('画中画')).toBe(false);
  });

  test('快进说明的秒数与常量一致', () => {
    const seekItem = PLAYER_HOTKEYS.find((i) => i.keys === '← / →');
    expect(seekItem?.action).toBe(`快退 / 快进 ${PLAYER_SEEK_STEP} 秒`);
  });
});
