import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProject, createSection, createSpace, listSpaces, updateSection } from '../../src/core/repo/projects';
import { syncLinkedSpaces } from '../../src/core/repo/linkedSpaces';

let db: Db; let projectId: number;
let source: { id: number }; let linkedA: { id: number }; let linkedB: { id: number }; let notLinked: { id: number };

beforeEach(() => {
  db = openDb(':memory:');
  const pj = createProject(db, { name: '项目' });
  projectId = pj.id;
  // sort_order 由创建顺序自然递增；source 是第一个创建的板块
  source = createSection(db, { projectId, name: '源板块' });
  linkedA = createSection(db, { projectId, name: '联动板块A' });
  linkedB = createSection(db, { projectId, name: '联动板块B' });
  notLinked = createSection(db, { projectId, name: '非联动板块' });
  updateSection(db, linkedA.id, { linkSpaces: true });
  updateSection(db, linkedB.id, { linkSpaces: true });
  // notLinked 保持 linkSpaces=false
});

describe('syncLinkedSpaces', () => {
  it('create：在所有 link_spaces=1 的板块新增同名非置底空间', () => {
    const count = syncLinkedSpaces(db, projectId, { type: 'create', name: '序厅' });
    expect(count).toBe(2);
    expect(listSpaces(db, linkedA.id).map(s => s.name)).toEqual(['序厅']);
    expect(listSpaces(db, linkedB.id).map(s => s.name)).toEqual(['序厅']);
    expect(listSpaces(db, notLinked.id)).toHaveLength(0);
    expect(listSpaces(db, linkedA.id)[0].pinBottom).toBe(false);
  });

  it('create：目标板块已有同名非置底空间时跳过（不重复创建），不计入返回数', () => {
    createSpace(db, { sectionId: linkedA.id, name: '序厅' });
    const count = syncLinkedSpaces(db, projectId, { type: 'create', name: '序厅' });
    expect(count).toBe(1); // 仅 linkedB 新建
    expect(listSpaces(db, linkedA.id)).toHaveLength(1);
    expect(listSpaces(db, linkedB.id)).toHaveLength(1);
  });

  it('create：新增空间插在置底空间之前', () => {
    createSpace(db, { sectionId: linkedA.id, name: '安防', pinBottom: true });
    syncLinkedSpaces(db, projectId, { type: 'create', name: '序厅' });
    expect(listSpaces(db, linkedA.id).map(s => s.name)).toEqual(['序厅', '安防']);
  });

  it('rename：按旧名匹配非置底空间改名，置底空间不受影响', () => {
    createSpace(db, { sectionId: linkedA.id, name: '旧名' });
    createSpace(db, { sectionId: linkedB.id, name: '旧名' });
    createSpace(db, { sectionId: linkedB.id, name: '旧名', pinBottom: true }); // 置底同名不应被改
    const count = syncLinkedSpaces(db, projectId, { type: 'rename', name: '新名', oldName: '旧名' });
    expect(count).toBe(2);
    expect(listSpaces(db, linkedA.id).map(s => s.name)).toEqual(['新名']);
    const bNames = listSpaces(db, linkedB.id).map(s => `${s.name}:${s.pinBottom}`);
    expect(bNames).toEqual(['新名:false', '旧名:true']);
  });

  it('rename：目标板块无匹配旧名空间时不计入返回数', () => {
    createSpace(db, { sectionId: linkedA.id, name: '旧名' });
    // linkedB 无同名空间
    const count = syncLinkedSpaces(db, projectId, { type: 'rename', name: '新名', oldName: '旧名' });
    expect(count).toBe(1);
  });

  it('无联动板块时返回 0', () => {
    updateSection(db, linkedA.id, { linkSpaces: false });
    updateSection(db, linkedB.id, { linkSpaces: false });
    const count = syncLinkedSpaces(db, projectId, { type: 'create', name: '序厅' });
    expect(count).toBe(0);
  });

  it('目标板块集合排除源自身（即便源板块 link_spaces 被置 1）', () => {
    updateSection(db, source.id, { linkSpaces: true });
    const count = syncLinkedSpaces(db, projectId, { type: 'create', name: '序厅' });
    expect(count).toBe(2); // 仍只有 linkedA/linkedB，不含 source 自己
    expect(listSpaces(db, source.id)).toHaveLength(0);
  });

  it('项目不存在板块或只有一个板块时返回 0', () => {
    const pj2 = createProject(db, { name: '空项目' });
    const only = createSection(db, { projectId: pj2.id, name: '唯一板块' });
    updateSection(db, only.id, { linkSpaces: true });
    const count = syncLinkedSpaces(db, pj2.id, { type: 'create', name: 'X' });
    expect(count).toBe(0);
  });
});
