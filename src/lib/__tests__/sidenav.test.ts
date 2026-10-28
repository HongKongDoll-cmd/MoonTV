/**
 * 首页侧边栏（SideNav）底座测试。
 *
 * 两件容易出事的地方各锁一层：
 * 1. 首屏内联脚本必须挂 `documentElement`（`<head>` 阶段 body 还是 null，
 *    挂 body 会抛错被吞 → 折叠态刷新必跳；这是本项目在主题脚本上踩过的同款坑）。
 * 2. 宽度常量与脚本里的字面量必须一致，否则改宽度时漏改脚本会让首屏宽度闪一下。
 */

import {
  applySidenavCollapsed,
  applySidenavHidden,
  normalizeSidenavAutohide,
  normalizeSidenavCollapsed,
  SIDENAV_AUTOHIDE_KEY,
  SIDENAV_COLLAPSED_ATTR,
  SIDENAV_COLLAPSED_KEY,
  SIDENAV_HIDDEN_ATTR,
  SIDENAV_INLINE_SCRIPT,
  SIDENAV_WIDTH_COLLAPSED,
  SIDENAV_WIDTH_EXPANDED,
  SIDENAV_WIDTH_FULL_VAR,
  SIDENAV_WIDTH_VAR,
  sidenavWidth,
} from '../sidenav';

describe('normalizeSidenavCollapsed', () => {
  it('只认显式真值写法', () => {
    for (const truthy of ['true', 'TRUE', ' true ', '1', 'yes', 'on']) {
      expect(normalizeSidenavCollapsed(truthy)).toBe(true);
    }
  });

  it('其余一律落回展开（折叠是少数状态，猜错时保持展开更安全）', () => {
    for (const falsy of ['false', '', '  ', '0', 'no', 'off', 'collapsed', null, undefined]) {
      expect(normalizeSidenavCollapsed(falsy)).toBe(false);
    }
  });
});

describe('sidenavWidth', () => {
  it('折叠比展开窄，且都为正数', () => {
    expect(sidenavWidth(false)).toBe(SIDENAV_WIDTH_EXPANDED);
    expect(sidenavWidth(true)).toBe(SIDENAV_WIDTH_COLLAPSED);
    expect(SIDENAV_WIDTH_COLLAPSED).toBeGreaterThan(0);
    expect(SIDENAV_WIDTH_COLLAPSED).toBeLessThan(SIDENAV_WIDTH_EXPANDED);
  });
});

describe('applySidenavCollapsed', () => {
  it('折叠态同时写属性与 CSS 变量', () => {
    const root = document.createElement('div');

    applySidenavCollapsed(true, root);

    expect(root.getAttribute(SIDENAV_COLLAPSED_ATTR)).toBe('true');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );
  });

  it('展开态写回 false 与展开宽度（可反复切换不回退）', () => {
    const root = document.createElement('div');

    applySidenavCollapsed(true, root);
    applySidenavCollapsed(false, root);

    expect(root.getAttribute(SIDENAV_COLLAPSED_ATTR)).toBe('false');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_EXPANDED}px`
    );
  });
});

describe('SIDENAV_INLINE_SCRIPT', () => {
  it('不引用 document.body（head 阶段它是 null）', () => {
    expect(SIDENAV_INLINE_SCRIPT).not.toContain('document.body');
    expect(SIDENAV_INLINE_SCRIPT).not.toMatch(/\bbody\b\s*\.\s*append/);
  });

  it('通过 document.documentElement 落状态', () => {
    expect(SIDENAV_INLINE_SCRIPT).toContain('document.documentElement');
  });

  it('把存储键、属性名与变量名编进脚本，不依赖运行时模块', () => {
    expect(SIDENAV_INLINE_SCRIPT).toContain(SIDENAV_COLLAPSED_KEY);
    expect(SIDENAV_INLINE_SCRIPT).toContain(SIDENAV_COLLAPSED_ATTR);
    expect(SIDENAV_INLINE_SCRIPT).toContain(SIDENAV_WIDTH_VAR);
  });

  it('两个宽度字面量都内联在脚本里', () => {
    expect(SIDENAV_INLINE_SCRIPT).toContain(String(SIDENAV_WIDTH_COLLAPSED));
    expect(SIDENAV_INLINE_SCRIPT).toContain(String(SIDENAV_WIDTH_EXPANDED));
  });

  it('脚本执行后：存 true 则折叠，未存则展开', () => {
    const run = (stored: string | null) => {
      const root = document.createElement('div');
      // 脚本内部用 document.documentElement，这里临时替换以便观察
      const original = Object.getOwnPropertyDescriptor(
        Document.prototype,
        'documentElement'
      );
      Object.defineProperty(document, 'documentElement', {
        configurable: true,
        get: () => root,
      });
      try {
        if (stored === null) {
          window.localStorage.removeItem(SIDENAV_COLLAPSED_KEY);
        } else {
          window.localStorage.setItem(SIDENAV_COLLAPSED_KEY, stored);
        }
        // eslint-disable-next-line no-new-func
        new Function(SIDENAV_INLINE_SCRIPT)();
      } finally {
        if (original) {
          Object.defineProperty(Document.prototype, 'documentElement', original);
        }
        window.localStorage.removeItem(SIDENAV_COLLAPSED_KEY);
      }
      return {
        attr: root.getAttribute(SIDENAV_COLLAPSED_ATTR),
        width: root.style.getPropertyValue(SIDENAV_WIDTH_VAR),
      };
    };

    expect(run('true')).toEqual({
      attr: 'true',
      width: `${SIDENAV_WIDTH_COLLAPSED}px`,
    });
    expect(run(null)).toEqual({
      attr: 'false',
      width: `${SIDENAV_WIDTH_EXPANDED}px`,
    });
  });
});


describe('normalizeSidenavAutohide', () => {
  it('显式真值写法视为开启', () => {
    for (const truthy of ['true', 'TRUE', ' true ', '1', 'yes', 'on']) {
      expect(normalizeSidenavAutohide(truthy)).toBe(true);
    }
  });

  it('其余一律关闭（默认关闭是刻意的）', () => {
    for (const falsy of ['false', '0', 'no', 'off', '', '  ', null, undefined]) {
      expect(normalizeSidenavAutohide(falsy as string | null | undefined)).toBe(
        false
      );
    }
  });
});

describe('applySidenavHidden', () => {
  it('隐藏时属性置 true 且内容区让位归零', () => {
    const root = document.createElement('html');
    applySidenavHidden(true, root);

    expect(root.getAttribute(SIDENAV_HIDDEN_ATTR)).toBe('true');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe('0px');
  });

  it('恢复时按**当前折叠状态**给出宽度，不能一律写展开值', () => {
    const root = document.createElement('html');
    root.setAttribute(SIDENAV_COLLAPSED_ATTR, 'true');
    applySidenavHidden(true, root);
    applySidenavHidden(false, root);

    expect(root.getAttribute(SIDENAV_HIDDEN_ATTR)).toBe('false');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );
  });

  it('展开态恢复时用展开宽度', () => {
    const root = document.createElement('html');
    root.setAttribute(SIDENAV_COLLAPSED_ATTR, 'false');
    applySidenavHidden(false, root);

    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_EXPANDED}px`
    );
  });

  it('拿不到 DOM 时不抛错', () => {
    expect(() => applySidenavHidden(true, null)).not.toThrow();
  });
});

describe('内联脚本同时处理自动隐藏', () => {
  it('脚本里引用了自动隐藏的键与属性（否则首屏会先展开再收起）', () => {
    expect(SIDENAV_INLINE_SCRIPT).toContain(SIDENAV_AUTOHIDE_KEY);
    expect(SIDENAV_INLINE_SCRIPT).toContain(SIDENAV_HIDDEN_ATTR);
  });

  it('脚本同时写侧栏自身宽度变量（隐藏时内容区让位但侧栏不变形）', () => {
    expect(SIDENAV_INLINE_SCRIPT).toContain(SIDENAV_WIDTH_FULL_VAR);
  });

  it('隐藏开启时内容区宽度记为 0', () => {
    // 执行脚本，模拟"自动隐藏已开启、未折叠"
    window.localStorage.setItem(SIDENAV_AUTOHIDE_KEY, 'true');
    window.localStorage.removeItem(SIDENAV_COLLAPSED_KEY);
    // eslint-disable-next-line no-new-func
    new Function(SIDENAV_INLINE_SCRIPT)();

    const root = document.documentElement;
    expect(root.getAttribute(SIDENAV_HIDDEN_ATTR)).toBe('true');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe('0px');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_FULL_VAR)).toBe(
      `${SIDENAV_WIDTH_EXPANDED}px`
    );

    window.localStorage.removeItem(SIDENAV_AUTOHIDE_KEY);
  });
});


describe('侧栏自身宽度变量必须与折叠态同步（4.8.3 回归）', () => {
  it('折叠与展开都要同时更新两个变量', () => {
    const root = document.createElement('html');

    applySidenavCollapsed(true, root);
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_FULL_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );

    applySidenavCollapsed(false, root);
    // 4.8.2 只更新了后者，侧栏宽度卡在 72px 却显示文字 → 文字被裁掉半截
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_FULL_VAR)).toBe(
      `${SIDENAV_WIDTH_EXPANDED}px`
    );
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_EXPANDED}px`
    );
  });

  it('隐藏再恢复后，侧栏宽度变量仍跟随折叠态', () => {
    const root = document.createElement('html');
    applySidenavCollapsed(true, root);

    applySidenavHidden(true, root);
    // 隐藏时内容区让位归零，但侧栏自身宽度保持不变
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe('0px');
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_FULL_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );

    applySidenavHidden(false, root);
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );
    expect(root.style.getPropertyValue(SIDENAV_WIDTH_FULL_VAR)).toBe(
      `${SIDENAV_WIDTH_COLLAPSED}px`
    );
  });
});
