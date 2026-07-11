/**
 * 语义化版本号纯函数比较：判断 latest 是否比 current 更新。
 * - 允许前缀 'v'（v0.16.0 / 0.16.0 均可）。
 * - 忽略预发布/构建元数据后缀（-beta.1 / +build 等），只比较 major.minor.patch。
 * - 无法解析的分段按 0 处理，避免抛错影响调用方（GitHub API 返回异常数据时静默降级）。
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const [lMajor, lMinor, lPatch] = parseCore(latest);
  const [cMajor, cMinor, cPatch] = parseCore(current);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

function parseCore(version: string): [number, number, number] {
  const cleaned = (version ?? '').trim().replace(/^v/i, '');
  const core = cleaned.split('-')[0].split('+')[0];
  const parts = core.split('.').map((p) => {
    const n = Number(p);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}
