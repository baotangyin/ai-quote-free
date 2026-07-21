import { describe, it, expect } from 'vitest';
import type { Project } from '../../src/shared/api-types';
import { matchProjectFilter, EMPTY_PROJECTS_FILTER } from '../../src/renderer/src/projectsFilter';

function mk(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: '项目A',
    client: '客户甲',
    projectType: null,
    mode: 'budget',
    defaultMargin: 1.3,
    roundRule: 'yuan',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('matchProjectFilter', () => {
  it('空筛选放行所有项目', () => {
    expect(matchProjectFilter(mk({}), EMPTY_PROJECTS_FILTER)).toBe(true);
  });

  it('modes 命中任一才放行', () => {
    const p = mk({ mode: 'tender' });
    expect(matchProjectFilter(p, { modes: ['tender'], statuses: [], keyword: '' })).toBe(true);
    expect(matchProjectFilter(p, { modes: ['budget', 'pricing'], statuses: [], keyword: '' })).toBe(false);
  });

  it('statuses 命中任一才放行', () => {
    const p = mk({ status: 'done' });
    expect(matchProjectFilter(p, { modes: [], statuses: ['done'], keyword: '' })).toBe(true);
    expect(matchProjectFilter(p, { modes: [], statuses: ['draft'], keyword: '' })).toBe(false);
  });

  it('keyword 匹配项目名或客户名，忽略大小写', () => {
    const p = mk({ name: 'Alpha 展厅', client: 'ACME 集团' });
    expect(matchProjectFilter(p, { modes: [], statuses: [], keyword: 'alpha' })).toBe(true);
    expect(matchProjectFilter(p, { modes: [], statuses: [], keyword: 'acme' })).toBe(true);
    expect(matchProjectFilter(p, { modes: [], statuses: [], keyword: '不存在' })).toBe(false);
  });

  it('client 为 null 时 keyword 仅按名称匹配，不报错', () => {
    const p = mk({ name: '甲项目', client: null });
    expect(matchProjectFilter(p, { modes: [], statuses: [], keyword: '甲' })).toBe(true);
    expect(matchProjectFilter(p, { modes: [], statuses: [], keyword: '乙' })).toBe(false);
  });

  it('多条件 AND 组合', () => {
    const p = mk({ mode: 'pricing', status: 'done', name: '造价清单项目', client: '某局' });
    expect(matchProjectFilter(p, { modes: ['pricing'], statuses: ['done'], keyword: '造价' })).toBe(true);
    expect(matchProjectFilter(p, { modes: ['pricing'], statuses: ['draft'], keyword: '造价' })).toBe(false);
  });
});
