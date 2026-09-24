/**
 * 选集按钮的短标签：把「整段文件名」折叠成 E01 / E02 ……
 *
 * 网盘（OpenList/小雅）把文件名直接当选集标题（`episodes_titles` 存的是
 * 相对路径），一部片名动辄五六十字，选集按钮 `whitespace-nowrap` 一裁，
 * 哪一集就完全看不出来了。文件名里的集数顺序已经在影库侧用自然序排好，
 * 所以这里只需要按**位置**生成 E01/E02 标签，原文件名保留在悬停提示里。
 *
 * 普通 CMS 源的标题是「第 X 集」或纯数字，行为保持不变。
 */

/** 常见视频容器扩展名（文件名式标题的最强信号） */
const VIDEO_EXT_RE =
  /\.(mp4|mkv|avi|mov|wmv|flv|ts|m2ts|mts|webm|rmvb|rm|mpg|mpeg|m4v|vob|iso)$/i;

/** 「第一季/E02.mkv」这类摊平后的相对路径 */
const SXXEXX_PREFIX_RE = /^[Ss]\d{1,2}\s?[Ee]\d{1,3}/;

/**
 * 标题是否长得很像一个视频文件（或路径）。
 * 命中即视为「文件名式标题」，选集按钮改用 E01 短标签。
 */
export function looksLikeFileTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (t.includes('/')) return true; // 相对路径（影库目录摊平）
  if (VIDEO_EXT_RE.test(t)) return true; // 带视频扩展名
  return SXXEXX_PREFIX_RE.test(t); // S01E01 开头
}

/**
 * 位置徽章：E01 / E02 ……
 * 位宽按总集数定（≤99 集两位、≤999 集三位），保证整列对齐。
 */
export function formatEpisodeBadge(
  episodeNumber: number,
  totalEpisodes: number
): string {
  const width = totalEpisodes >= 1000 ? 4 : totalEpisodes >= 100 ? 3 : 2;
  return `E${String(episodeNumber).padStart(width, '0')}`;
}

/**
 * 选集按钮上显示的文案。
 *
 * 优先级：
 * 1. 没有标题 → 纯集号（原行为）
 * 2. 文件名式标题 → E01 短标签（本模块新增，原文件名交给 hover 提示）。
 *    「第X集」判定放在文件名之后：网盘里「第005集.mkv」既像文件名又含
 *    「第X集」，按文件名统一折叠成 E005，与同目录其它 E 标签对齐
 * 3. 「第 X 集」→ 只留数字（原行为，CMS 源）
 * 4. 其它（CMS 集名等）→ 原样显示（原行为）
 */
export function resolveEpisodeButtonText(
  title: string | undefined,
  episodeNumber: number,
  totalEpisodes: number
): string {
  if (!title || !title.trim()) return String(episodeNumber);
  if (looksLikeFileTitle(title)) {
    return formatEpisodeBadge(episodeNumber, totalEpisodes);
  }
  const match = title.match(/第(\d+)集/);
  if (match) return match[1];
  return title;
}
