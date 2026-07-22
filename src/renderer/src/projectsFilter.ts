import type { Project, QuoteMode } from '../../shared/api-types';

/** 项目列表深度筛选条件（持久化至 localStorage）。 */
export interface ProjectsFilter {
  modes: QuoteMode[];
  statuses: Project['status'][];
  keyword: string;
}

export const EMPTY_PROJECTS_FILTER: ProjectsFilter = { modes: [], statuses: [], keyword: '' };

/**
 * 项目筛选谓词（AND 组合，纯函数便于单测）。
 * - modes：命中任一或为空则不限；
 * - statuses：命中任一或为空则不限；
 * - keyword：匹配项目名或客户名（忽略大小写），为空则不限。
 */
export function matchProjectFilter(p: Project, filter: ProjectsFilter): boolean {
  if (filter.modes.length > 0 && !filter.modes.includes(p.mode)) return false;
  if (filter.statuses.length > 0 && !filter.statuses.includes(p.status)) return false;
  const kw = filter.keyword.trim().toLowerCase();
  if (kw) {
    const inName = p.name.toLowerCase().includes(kw);
    const inClient = (p.client ?? '').toLowerCase().includes(kw);
    if (!inName && !inClient) return false;
  }
  return true;
}
