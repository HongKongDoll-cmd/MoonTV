/**
 * 片头跳过（4.5.9）
 *
 * 项目里本来就有「跳过片头片尾」的配置与自动跳过逻辑（`skipConfig.intro_time`），
 * 但必须**先知道片头有多长**才能用 —— 而用户第一次看一部番根本不知道，
 * 于是这个功能等于「没有」。本模块解决的就是这个缺口：
 *
 *   1. 片头区间里浮出一个「跳过片头」按钮（时长从哪来？见 `resolveIntroEnd`）；
 *   2. 用户点一次就把这个长度记住（本地存储，按「源+片名」维度），
 *      下次进同一集自动跳 —— **一次手动，全程自动**。
 *
 * 刻意不做的事：不猜「这是片头曲」之类的内容识别。判断片头靠的是
 * 「用户第一次手动跳到了哪里」这个确定的事实，比猜准得多也诚实得多。
 */

/** 记住片头长度的存储键前缀（真正的 key 后面拼 source+id）。 */
export const INTRO_SKIP_STORAGE_PREFIX = 'moontv_intro_skip:';

/**
 * 记住的片头长度上限（秒）。
 *
 * 超过 5 分钟的「片头」几乎一定是用户拖错了位置，不该被记下来
 * —— 否则之后每次进这一集都会被莫名其妙地跳过 5 分钟。
 */
export const MAX_INTRO_SECONDS = 300;

/**
 * 自动跳过按钮的最短片头长度（秒）。
 *
 * 比这更短的「片头」不值得跳：点一下省不到 5 秒，
 * 反而打断刚进入剧情的注意力。
 */
export const MIN_AUTO_SKIP_SECONDS = 5;

/** 一集短于这个秒数时，整集都当片头是不合理的，禁用自动跳过。 */
export const MIN_DURATION_FOR_SKIP = 120;

/**
 * 记住的片头长度是否可信。
 *
 * 三个约束：
 *   - 不能是非数字/负数/NaN；
 *   - 不能短于 `MIN_AUTO_SKIP_SECONDS`（省不到几秒还叫什么跳过）；
 *   - 不能长于全片的一半（多半是拖错了，不该记住）。
 */
export function isTrustworthyIntroEnd(
  introEnd: number | undefined | null,
  duration = 0
): boolean {
  if (typeof introEnd !== 'number' || !Number.isFinite(introEnd)) return false;
  if (introEnd < MIN_AUTO_SKIP_SECONDS) return false;
  if (introEnd > MAX_INTRO_SECONDS) return false;
  // 一集比片头还短（或相近）就不跳了
  if (duration > 0 && introEnd >= duration / 2) return false;
  return true;
}

/**
 * 算出这一集实际该用的片头结束时间。
 *
 * 优先级：
 *   1. 用户在设置里手填的 `skipConfig.intro_time`（既有功能，最优先）；
 *   2. 本地记住的长度（上次手动跳过时存的）；
 *   3. 都没有 → 0，表示「不知道片头多长」，此时只显示一个**不自动跳**的按钮，
 *      让用户第一次点一下（点完就记住了），而不是什么都不给。
 */
export function resolveIntroEnd(
  configuredIntroTime: number,
  rememberedIntroEnd: number | undefined | null,
  duration = 0
): number {
  if (configuredIntroTime > 0) {
    return Math.min(configuredIntroTime, MAX_INTRO_SECONDS);
  }
  if (isTrustworthyIntroEnd(rememberedIntroEnd, duration)) {
    return rememberedIntroEnd as number;
  }
  return 0;
}

/**
 * 当前是否该显示「跳过片头」按钮。
 *
 * `introEnd` 为 0（还不知道片头多长）时，只要还在片头候选区间内就显示，
 * 按钮点击后会「把当前位置当作片头结束」——这是第一次使用的入口。
 */
export function shouldShowIntroSkip(
  currentTime: number,
  introEnd: number,
  duration = 0
): boolean {
  if (!Number.isFinite(currentTime) || currentTime < 0) return false;
  // 已经在正常播放区（越过片头）就不用了
  if (introEnd > 0 && currentTime >= introEnd) return false;
  // 片头区间上界：已知的用已知值；未知的给 3 分钟的候选窗
  const window = introEnd > 0 ? introEnd : 180;
  if (currentTime >= window) return false;
  // 极短的片子不显示（整集都像片头，跳了没意义）
  if (duration > 0 && duration < MIN_DURATION_FOR_SKIP) return false;
  // 已经播到片头之后一点点（比如 0.5 秒处）不打扰：刚点开就弹按钮很怪
  if (introEnd > 0 && introEnd - currentTime < 1) return false;
  return true;
}

/**
 * 按钮文案。
 *
 * 已知片头长度 → 「跳过片头 (02:15)」；
 * 不知道 → 「跳过片头」，并且让调用方把 `learnFrom` 设成当前时间。
 */
export function buildIntroSkipLabel(introEnd: number): string {
  if (introEnd > 0) {
    const total = Math.floor(introEnd);
    const m = Math.floor(total / 60);
    const s = total % 60;
    const text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `跳过片头 (${text})`;
  }
  return '跳过片头';
}

/**
 * 用户点了「跳过片头」之后要记下的长度。
 *
 * - 已知片头长度：就用它（点一下等价于按已配置的方式跳）；
 * - 未知：把**当前播放位置**当作片头结束 —— 也就是「我从这里开始看正文」。
 *
 * 返回 0 表示这次点击不值得记住（位置太早，点了等于没跳）。
 */
export function resolveLearnedIntroEnd(
  currentTime: number,
  introEnd: number,
  duration = 0
): number {
  if (introEnd > 0) return introEnd;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  const rounded = Math.round(currentTime);
  // 记下来的长度要过可信度校验，否则噪声会永久生效
  return isTrustworthyIntroEnd(rounded, duration) ? rounded : 0;
}

/** 存储 key：按「源 + 片名」维度，换源/换集互不干扰。 */
export function buildIntroSkipStorageKey(source: string, id: string): string {
  // 源+id 里可能带斜杠与中文，做一次可读化处理，避免 key 过长或出现奇怪字符
  const safe = `${source}:${id}`.replace(/[/?#\s]+/g, '_');
  return `${INTRO_SKIP_STORAGE_PREFIX}${safe}`;
}
