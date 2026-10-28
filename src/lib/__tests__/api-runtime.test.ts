/**
 * Cloudflare 部署的构建门禁（4.8.5）。
 *
 * `@cloudflare/next-on-pages` 要求**所有**动态路由跑在 Edge Runtime 上，
 * 只要漏一个，整个构建就失败并报：
 *   "The following routes were not configured to run with the Edge Runtime"
 *
 * 这个错误在浏览器侧只表现为接口 500，很容易被误判成数据库/绑定问题 ——
 * 4.8.1 新增 /api/intro 时就没写这一行，导致后面几轮部署全部失败。
 * 用测试把它钉住，以后新增 route 忘了声明会在这里直接红。
 */

import fs from 'fs';
import path from 'path';

const API_ROOT = path.join(process.cwd(), 'src/app/api');

function collectRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      out.push(full);
    }
  }
  return out;
}

describe('API 路由的 Edge Runtime 声明', () => {
  const routes = collectRouteFiles(API_ROOT);

  test('确实扫描到了路由文件（防止路径写错导致空跑）', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  test('每一个 API 路由都声明了 runtime = "edge"', () => {
    const missing = routes.filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return !/export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(source);
    });

    // 失败时把文件列出来，直接告诉你要改哪个文件
    expect(missing.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
