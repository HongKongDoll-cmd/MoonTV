/**
 * 首页左侧导航栏（SideNav）的共享常量与首屏脚本。
 *
 * ## 为什么需要单独一层
 *
 * 侧边栏要「可折叠」，而折叠状态存在 localStorage。如果等 React 挂载后
 * 再读，刷新页面会先按展开态画一遍再收窄 —— 肉眼可见的一次横向抖动。
 *
 * 所以宽度真源放在这里，由 `SIDENAV_INLINE_SCRIPT` 在**首屏绘制前**
 * 同步写进 `<html>`：
 *   - `data-sidenav-collapsed` 属性 → 驱动文字/搜索框的显隐（纯 CSS）
 *   - `--moontv-sidenav-w` 变量     → 驱动侧边栏宽度与内容区左内边距
 *
 * 组件侧只需在用户点折叠时同步同一份状态，视觉与交互因此不会打架。
 *
 * ⚠️ 内联脚本挂在 `document.documentElement` 上。这是本项目踩过的坑：
 * `<head>` 阶段 `document.body` 还是 `null`，挂上去会抛错并被 catch 吞掉，
 * 表现为「设置完全不生效」（见 `theme-palette.ts` 的同款问题）。
 */

/** 折叠状态在 localStorage 中的键 */
export const SIDENAV_COLLAPSED_KEY = 'moontv_sidenav_collapsed';

/**
 * 展开时侧边栏宽度（px）。
 *
 * 按内容实测取值，不是拍脑袋（真机量过，见 docs/tools/check-sidenav-width.mjs）：
 *   品牌行（站点名 + 折叠按钮）最宽 —— 收紧内距后仍需约 144px，是定宽的约束项
 *   导航项（图标 + 文字 + 左右内边距）约 98px
 *   底部「下载管理」四字约 112px
 *   就地展开的影视库子菜单约 103px
 * 原来的 224px 有一半是空地，在 1440px 宽屏上等于白白吃掉 80px 内容区。
 */
export const SIDENAV_WIDTH_EXPANDED = 144;

/** 折叠时侧边栏宽度（px），只放得下图标 */
export const SIDENAV_WIDTH_COLLAPSED = 72;

/** 挂在 `<html>` 上的折叠标记，CSS 依赖它切换视觉 */
export const SIDENAV_COLLAPSED_ATTR = 'data-sidenav-collapsed';

/** 侧边栏宽度对应的 CSS 变量名（内容区靠它让位） */
export const SIDENAV_WIDTH_VAR = '--moontv-sidenav-w';

/**
 * 侧边栏**自身**宽度对应的变量（4.8.2）。
 *
 * 自动隐藏时内容区要让位（`--moontv-sidenav-w` → 0），但侧栏本身得保持原宽度
 * 才能平滑地平移出去。用一个独立变量把这两件事分开，
 * 否则宽度被设成 0 的同时做 translateX，动画会先被压扁再滑走。
 */
export const SIDENAV_WIDTH_FULL_VAR = '--moontv-sidenav-w-full';

/** 自动隐藏开关在 localStorage 中的键 */
export const SIDENAV_AUTOHIDE_KEY = 'moontv_sidenav_autohide';

/** 自动隐藏态（侧栏滑出屏幕）挂在 `<html>` 上的属性 */
export const SIDENAV_HIDDEN_ATTR = 'data-sidenav-hidden';

/**
 * 顶部热区高度（px）。
 *
 * 屏幕最上面这一条留给"唤出侧栏"。取 8px：太小不好瞄准，
 * 太大又会让正常操作（点顶部附近的按钮）反复把侧栏拉出来。
 */
export const SIDENAV_TOP_HOT_ZONE_PX = 8;

/**
 * 指针离开后延迟收起的时间（ms）。
 *
 * 存在的意义：用户常常"从顶部滑一下 → 再移到侧栏内部点项目"，
 * 如果离开顶部就立刻收起，中间那段空隙会让侧栏闪一下又回来。
 */
export const SIDENAV_AUTOHIDE_DELAY_MS = 350;

/**
 * 当前页修改开关时派发的自定义事件名。
 *
 * `storage` 事件**只在其它标签页**触发，本页监听不到自己写入的值 ——
 * 只靠它会出现「点了开关没反应」，必须再补一个同页事件。
 */
export const SIDENAV_AUTOHIDE_EVENT = 'sidenav-autohide-changed';

/**
 * 把 localStorage 里读到的原始字符串收敛成布尔值。
 *
 * 只认显式的真值写法：历史上可能有 `"true"` / `"1"` 等多种来源，
 * 而 `"false"` / 空 / 损坏值都必须落回「展开」——折叠是少数状态，
 * 猜错时保持展开比误折叠安全。
 */
export function normalizeSidenavCollapsed(
  raw: string | null | undefined
): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

/** 折叠状态 → 像素宽度 */
export function sidenavWidth(collapsed: boolean): number {
  return collapsed ? SIDENAV_WIDTH_COLLAPSED : SIDENAV_WIDTH_EXPANDED;
}

/**
 * 把折叠状态写到 DOM 上（属性 + CSS 变量）。
 *
 * `root` 可注入，便于测试；浏览器里默认取 `<html>`。
 * 非浏览器环境（SSR / 单测无 DOM）直接跳过，不抛异常。
 */
export function applySidenavCollapsed(
  collapsed: boolean,
  root?: HTMLElement | null
): void {
  const target =
    root ??
    (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;

  target.setAttribute(SIDENAV_COLLAPSED_ATTR, collapsed ? 'true' : 'false');

  const width = `${sidenavWidth(collapsed)}px`;

  /**
   * 两个变量都要更新（4.8.3 修复）。
   *
   * `--moontv-sidenav-w-full` 决定侧栏**自身**宽度，`--moontv-sidenav-w`
   * 决定内容区让位。4.8.2 引入前者时只让首屏内联脚本写过一次，
   * 之后点折叠/展开只更新了后者 —— 结果侧栏宽度卡在首屏那个值上，
   * 展开后仍是 72px 却开始显示文字，文字被裁掉半截。
   */
  target.style.setProperty(SIDENAV_WIDTH_FULL_VAR, width);
  target.style.setProperty(SIDENAV_WIDTH_VAR, width);
}

/**
 * 把 localStorage 里读到的自动隐藏原始值收敛成布尔值。
 *
 * 与折叠状态相反：**默认关闭**。自动隐藏会改变用户习惯的动作成本
 * （每次都要去顶部热区），属于"用户主动开启"的偏好，猜错时保持关闭更安全。
 */
export function normalizeSidenavAutohide(
  raw: string | null | undefined
): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

/**
 * 把「自动隐藏」态写到 DOM 上。
 *
 * - `data-sidenav-hidden` 属性 → 驱动侧栏的 translateX（纯 CSS）
 * - 内容区宽度变量 → 隐藏时归零，让内容占满整行
 *
 * 侧栏自身宽度走 {@link SIDENAV_WIDTH_FULL_VAR}，不受这里影响。
 */
export function applySidenavHidden(
  hidden: boolean,
  root?: HTMLElement | null
): void {
  const target =
    root ??
    (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;

  target.setAttribute(SIDENAV_HIDDEN_ATTR, hidden ? 'true' : 'false');

  // 恢复时按当前折叠状态给出正确宽度，不能一律写展开值
  const collapsed =
    target.getAttribute(SIDENAV_COLLAPSED_ATTR) === 'true';
  const width = `${sidenavWidth(collapsed)}px`;

  // 侧栏自身宽度始终跟着折叠态走；只有内容区让位会在隐藏时归零
  target.style.setProperty(SIDENAV_WIDTH_FULL_VAR, width);
  target.style.setProperty(SIDENAV_WIDTH_VAR, hidden ? '0px' : width);
}

/**
 * 首屏内联脚本：在 React 挂载前就把折叠态落到 `<html>` 上。
 *
 * 宽度字面量直接内联（不引用变量），因此这里**刻意**复用了两个常量，
 * 测试会校验脚本里确实出现了这两个数字，防止改宽度时漏改脚本。
 */
export const SIDENAV_INLINE_SCRIPT = `(function(){try{var c=localStorage.getItem('${SIDENAV_COLLAPSED_KEY}')==='true';var a=localStorage.getItem('${SIDENAV_AUTOHIDE_KEY}')==='true';var r=document.documentElement;var w=c?${SIDENAV_WIDTH_COLLAPSED}:${SIDENAV_WIDTH_EXPANDED};r.setAttribute('${SIDENAV_COLLAPSED_ATTR}',c?'true':'false');r.setAttribute('${SIDENAV_HIDDEN_ATTR}',a?'true':'false');r.style.setProperty('${SIDENAV_WIDTH_FULL_VAR}',w+'px');r.style.setProperty('${SIDENAV_WIDTH_VAR}',(a?0:w)+'px');}catch(e){}})();`;
