/**
 * 搜索词的规范化（4.7.0）。
 *
 * 问题：豆瓣/番组tv 的标题常带后缀括号 —— `沙丘 (2021)`、`进击的巨人（国语版）`、
 * `某片【高清】`。而采集站（苹果 CMS 系）的标题里通常没有这些后缀，
 * 它们的 `wd=` 是模糊匹配，**带上括号内容就一条都搜不到**。
 * 表现就是「豆瓣点进来能看，搜索/换源却找不到任何播放源」。
 *
 * 所以向下游源站发查询时只送**主标题**；完整标题仍保留在结果与播放记录里，
 * 用于展示和播放源匹配，不会被这个函数改掉。
 */

/** 各种左括号 → 对应的右括号 */
const PAIR: Record<string, string> = {
  '（': '）',
  '(': ')',
  '【': '】',
  '[': ']',
  '〔': '〕',
};

const OPENERS = Object.keys(PAIR);
const CLOSERS = Object.values(PAIR);

/** 括号是否完全配对（不成对时不做剥离，避免把后半截整段吃掉） */
function bracketsBalanced(text: string): boolean {
  const stack: string[] = [];
  for (const ch of text) {
    if (OPENERS.includes(ch)) {
      stack.push(PAIR[ch]);
    } else if (CLOSERS.includes(ch)) {
      if (stack.pop() !== ch) return false;
    }
  }
  return stack.length === 0;
}

/**
 * 去掉成对括号及其内容，支持嵌套（`片名 (A (B))` → `片名`）。
 *
 * 用栈逐个字符扫描，而不是正则 —— 嵌套与全角/半角混排用正则会越写越乱。
 */
function stripBrackets(text: string): string {
  if (!bracketsBalanced(text)) return text;

  let out = '';
  const stack: string[] = [];
  for (const ch of text) {
    if (OPENERS.includes(ch)) {
      stack.push(PAIR[ch]);
      continue;
    }
    if (stack.length > 0) {
      if (ch === stack[stack.length - 1]) stack.pop();
      // 括号内的所有内容（含内层括号）都丢弃
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 由展示标题得到**发给下游源站的搜索词**。
 *
 * 规则：
 * 1. 剥掉成对括号及其内容（全角/半角圆括号、方括号、方头括号）
 * 2. 压缩连续空白、去掉残留的分隔符与拖尾标点
 * 3. 结果为空（标题本身就是纯括号内容）时**回退为原串**，绝不能把查询搜成空
 *
 * 纯函数、不改入参；`null`/`undefined`/空串安全返回空串。
 */
export function buildSearchQuery(title: string | null | undefined): string {
  const raw = (title || '').trim();
  if (!raw) return '';

  const base = stripBrackets(raw)
    // 括号剥掉后常留下多余的分隔符与空白
    .replace(/[·・,，、/|｜]+/g, ' ')
    .replace(/\s+/g, ' ')
    // 拖尾的空格与连接符一起清掉：`片名 - ` 的结尾是空格，
    // 只匹配 `[-—–]+$` 会漏掉，结果会剩下一个孤零零的 `片名 -`
    .replace(/[\s\-—–:：]+$/, '')
    .trim();

  return base || raw;
}
