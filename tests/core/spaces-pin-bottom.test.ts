import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';
import { createProject, createSection, createSpace, updateSpace, listSpaces } from '../../src/core/repo/projects';
import { duplicateProject } from '../../src/core/repo/projectDuplicate';

const setup = () => {
  const db = openDb(':memory:');
  const p = createProject(db, { name: '测试项目' });
  const sec = createSection(db, { projectId: p.id, name: '多媒体硬件' });
  return { db, p, sec };
};

describe('空间置底 pin_bottom', () => {
  it('新建空间恒排在置底空间之前', () => {
    const { db, sec } = setup();
    createSpace(db, { sectionId: sec.id, name: '安防监控系统设备', pinBottom: true });
    createSpace(db, { sectionId: sec.id, name: '中控及网络设备', pinBottom: true });
    createSpace(db, { sectionId: sec.id, name: '序厅' });
    createSpace(db, { sectionId: sec.id, name: '主展区' });
    expect(listSpaces(db, sec.id).map((s) => s.name))
      .toEqual(['序厅', '主展区', '安防监控系统设备', '中控及网络设备']);
    db.close();
  });

  it('createSpace 默认 pinBottom=false，updateSpace 可切换', () => {
    const { db, sec } = setup();
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    expect(sp.pinBottom).toBe(false);
    const updated = updateSpace(db, sp.id, { pinBottom: true });
    expect(updated.pinBottom).toBe(true);
    db.close();
  });

  it('置底组内保持创建顺序，updateSpace 不动 pinBottom 时保留原值', () => {
    const { db, sec } = setup();
    const a = createSpace(db, { sectionId: sec.id, name: 'A', pinBottom: true });
    createSpace(db, { sectionId: sec.id, name: 'B', pinBottom: true });
    updateSpace(db, a.id, { name: 'A2' });
    expect(listSpaces(db, sec.id).map((s) => `${s.name}:${s.pinBottom}`)).toEqual(['A2:true', 'B:true']);
    db.close();
  });

  it('projectDuplicate 保留 pin_bottom', () => {
    const { db, p, sec } = setup();
    createSpace(db, { sectionId: sec.id, name: '安防监控系统设备', pinBottom: true });
    createSpace(db, { sectionId: sec.id, name: '序厅' });
    const copy = duplicateProject(db, p.id);
    const copySections = db.prepare('SELECT id FROM sections WHERE project_id=?').all(copy.id) as any[];
    const spaces = listSpaces(db, copySections[0].id);
    expect(spaces.map((s) => `${s.name}:${s.pinBottom}`)).toEqual(['序厅:false', '安防监控系统设备:true']);
    db.close();
  });
});
