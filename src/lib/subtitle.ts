/**
 * 字幕发现与匹配。
 *
 * ## 为什么做「同目录扫描」而不是接字幕站
 *
 * 接 opensubtitles / 字幕库这类站要么需要 API key、要么有反爬，长期不可靠。
 * 而网盘用户的现实情况是：字幕常常就躺在视频旁边（`E01.zh.srt`），
 * 或者整季放在剧集目录里。所以这里做的是**零外部依赖**的方案：
 * 影库详情时把视频所在目录（及子目录）里的字幕文件一起列出来，
 * 按「集数标识 + 语言」自动匹配到当前这一集。
 *
 * 另外保留「手动填字幕地址」的口子（见播放页字幕面板），给自备字幕源的用户。
 *
 * 全部是纯函数，便于单测。
 */

/** 支持的字幕扩展名（小写，含点） */
export const SUBTITLE_EXTENSIONS = [
  '.srt',
  '.ass',
  '.ssa',
  '.vtt',
  '.sub',
  '.smi',
] as const;

export type SubtitleType = 'srt' | 'ass' | 'vtt';

/** 判断文件名是否是字幕文件 */
export function isSubtitleFile(name: string): boolean {
  const lower = (name || '').trim().toLowerCase();
  return SUBTITLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 从文件名推断字幕类型（ArtPlayer 的 subtitle.type） */
export function guessSubtitleType(name: string): SubtitleType {
  const lower = (name || '').trim().toLowerCase();
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return 'ass';
  if (lower.endsWith('.vtt')) return 'vtt';
  // .srt / .sub / .smi 都按 srt 解析（ArtPlayer 会自行转换时间轴）
  return 'srt';
}

/** 去掉扩展名，得到字幕的「主名」 */
export function stripSubtitleExtension(name: string): string {
  const value = (name || '').trim();
  const lower = value.toLowerCase();
  const ext = SUBTITLE_EXTENSIONS.find((item) => lower.endsWith(item));
  return ext ? value.slice(0, -ext.length) : value;
}

/**
 * 从文件名里提取「集数标识」，用于字幕与视频配对。
 *
 * 支持三种常见写法，统一成 `s01e01` / `e01` / 第01集 → `c01`：
 *   `S01E01.mkv`            → `s01e01`
 *   `第01集.mkv`            → `c01`
 *   `E01.mkv`               → `e01`
 *   `xxx_S01E02_yyy.mkv`    → `s01e02`（取片段里第一个）
 *
 * 提取不到时返回空串（此时只能靠「同目录唯一字幕」兜底）。
 */
export function extractEpisodeKey(fileName: string): string {
  const base = stripSubtitleExtension(fileName);

  // S01E01 / s1e1（允许中间有分隔符：S01.E01、S01-E01）
  const sxe = base.match(/s(\d{1,2})\s*[._-]?\s*e(\d{1,3})/i);
  if (sxe) {
    return `s${String(parseInt(sxe[1], 10)).padStart(2, '0')}e${String(
      parseInt(sxe[2], 10)
    ).padStart(2, '0')}`;
  }

  // 第01集 / 第1话 / 第 12 集
  const cn = base.match(/第\s*(\d{1,3})\s*[集话話]/);
  if (cn) {
    return `c${String(parseInt(cn[1], 10)).padStart(2, '0')}`;
  }

  // 独立的 E01 / EP01（第 5 集已在前一分支处理）
  const eOnly = base.match(/(?:^|[^a-z0-9])e(?:p|pisode)?\s*(\d{1,3})/i);
  if (eOnly) {
    return `e${String(parseInt(eOnly[1], 10)).padStart(2, '0')}`;
  }

  return '';
}

/** 识别字幕语言（从文件名里的标记），返回 ISO 风格代码 */
export type SubtitleLang = 'zh-Hans' | 'zh-Hant' | 'en' | 'unknown';

export function detectSubtitleLang(fileName: string): SubtitleLang {
  const base = stripSubtitleExtension(fileName).toLowerCase();

  // 繁体优先判（简繁标记常混用，如「繁中」也可能是「中文」）
  if (/(繁体|繁體|繁中|zh[-_.]?(tw|hk|mo)|cht|big5|traditional)/.test(base)) {
    return 'zh-Hant';
  }
  if (/(简体|簡体|简中|简體|zh[-_.]?(cn|sg|my)|chs|gb\s?2312|simplified)/.test(base)) {
    return 'zh-Hans';
  }
  // 裸 .zh / .en / .eng（后面不能再跟字母，否则 zh-CN 那类已被上面处理）
  if (/(^|[^a-z])zh(?![a-z])/.test(base)) return 'zh-Hans';
  if (/(^|[^a-z])(en|eng)(?![a-z])/.test(base)) return 'en';
  if (/(english|英文)/.test(base)) return 'en';
  // 只写「中」也算简体
  if (/中/.test(base)) return 'zh-Hans';

  return 'unknown';
}

export const SUBTITLE_LANG_LABELS: Record<SubtitleLang, string> = {
  'zh-Hans': '简体',
  'zh-Hant': '繁体',
  en: '英文',
  unknown: '未标注',
};

export interface SubtitleTrack {
  /** 展示用名字（已带语言后缀） */
  name: string;
  /** 字幕文件地址（可直接给 ArtPlayer 用） */
  url: string;
  /** 字幕类型 */
  type: SubtitleType;
  /** 语言 */
  lang: SubtitleLang;
  /** 原始文件名 */
  fileName: string;
  /** 从文件名提取的集数标识（可能为空串） */
  episodeKey: string;
}

/** 字幕重名时避免名称完全一样导致用户分不清 */
function uniqueTrackName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let index = 2;
  while (used.has(`${name} (${index})`)) index += 1;
  const result = `${name} (${index})`;
  used.add(result);
  return result;
}

/**
 * 从一份文件列表里挑出字幕，生成可选字幕轨。
 *
 * @param entries 形如 `{ name, url }` 的列表（已过滤为字幕文件）
 */
export function buildSubtitleTracks(
  entries: Array<{ name: string; url: string }>
): SubtitleTrack[] {
  const used = new Set<string>();
  return entries
    .filter((item) => item && item.name && item.url && isSubtitleFile(item.name))
    .map((item) => {
      const lang = detectSubtitleLang(item.name);
      const baseName = stripSubtitleExtension(item.name);
      const label =
        lang === 'unknown' ? baseName : `${baseName} [${SUBTITLE_LANG_LABELS[lang]}]`;
      return {
        name: uniqueTrackName(label, used),
        url: item.url,
        type: guessSubtitleType(item.name),
        lang,
        fileName: item.name,
        episodeKey: extractEpisodeKey(item.name),
      };
    });
}

/** 语言优先级：简体 > 繁体 > 英文 > 未标注（中文用户最常用简体） */
function langScore(lang: SubtitleLang): number {
  switch (lang) {
    case 'zh-Hans':
      return 3;
    case 'zh-Hant':
      return 2;
    case 'en':
      return 1;
    default:
      return 0;
  }
}

/**
 * 给某个视频挑一条最合适的字幕。
 *
 * 依次尝试：
 *   1. **文件名带集数标识且与视频一致** —— 最可靠
 *   2. 视频没有集数标识时，取候选里语言优先级最高的
 *   3. 候选只有一条 —— 直接用（用户把整季字幕放一起的常见情况）
 *
 * @param videoName 视频文件名（如 `E01.mkv`）
 * @param tracks 全部字幕轨
 */
export function pickSubtitleTrack(
  videoName: string,
  tracks: SubtitleTrack[]
): SubtitleTrack | null {
  if (!tracks || tracks.length === 0) return null;

  const videoKey = extractEpisodeKey(videoName);

  if (videoKey) {
    const exact = tracks.filter((track) => track.episodeKey === videoKey);
    if (exact.length > 0) {
      return [...exact].sort((a, b) => langScore(b.lang) - langScore(a.lang))[0];
    }
    return null;
  }

  if (tracks.length === 1) return tracks[0];

  return [...tracks].sort((a, b) => langScore(b.lang) - langScore(a.lang))[0];
}

/** 字幕样式预设（对齐 ArtPlayer 的 subtitle.style 接受的 CSS 名称） */
export interface SubtitleStylePreset {
  id: string;
  label: string;
  fontSize: number;
  /** bottom：距底部的百分比 */
  bottom: number;
  color: string;
  background: string;
}

/** 顺序即 UI 展示顺序：小 → 中 → 大 */
export const SUBTITLE_STYLE_PRESETS: SubtitleStylePreset[] = [
  { id: 'small', label: '小', fontSize: 22, bottom: 8, color: '#ffffff', background: 'rgba(0,0,0,0.4)' },
  { id: 'medium', label: '中', fontSize: 30, bottom: 8, color: '#ffffff', background: 'rgba(0,0,0,0.5)' },
  { id: 'large', label: '大', fontSize: 42, bottom: 8, color: '#ffffff', background: 'rgba(0,0,0,0.6)' },
];

/** 字体大小档位（滑块用） */
export const SUBTITLE_FONT_SIZES = [18, 22, 26, 30, 36, 42, 48] as const;

/** 把预设换算成 ArtPlayer subtitle.style 需要的对象 */
export function toSubtitleStyleObject(
  preset: SubtitleStylePreset
): Record<string, string> {
  return {
    fontSize: `${preset.fontSize}px`,
    bottom: `${preset.bottom}%`,
    color: preset.color,
    background: preset.background,
  };
}
