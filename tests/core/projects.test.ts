import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import {
  createProject, getProject, deleteProject, updateProject,
  createSection, listSections, updateSection,
  createSpace, listSpaces, updateSpace,
  createLineItem, listLineItems, updateLineItem,
} from '../../src/core/repo/projects';
import type { LineItemSnapshot } from '../../src/core/domain/types';

const snap: LineItemSnapshot = {
  name: 'P1.8室内全彩LED屏', brand: '洲明', model: 'P1.8',
  recommendedBrands: [], paramsCore: '像素间距1.8mm', paramsBid: null, paramsTender: null,
  unit: '㎡', dims: '7680*1600', power220W: 800, power380W: 0,
  rackU: 0, seqPowerPorts: 1, netPorts: 0, comPorts: 0,
  costUnitCents: 480000, optionsApplied: [],
};

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

describe('project tree', () => {
  it('builds 4-level tree with auto sortOrder', () => {
    const pj = createProject(db, { name: '翔威新能源' });
    const sec = createSection(db, { projectId: pj.id, name: '展厅多媒体硬件', integrationFeeRate: 0.05 });
    const sec2 = createSection(db, { projectId: pj.id, name: '软件影片' });
    expect(listSections(db, pj.id).map(s => s.sortOrder)).toEqual([0, 1]);
    const sp = createSpace(db, { sectionId: sec.id, name: '序厅' });
    const item = createLineItem(db, { spaceId: sp.id, snapshot: snap, qty: 73.73 });
    expect(item.snapshot.costUnitCents).toBe(480000);
    expect(listLineItems(db, sp.id)).toHaveLength(1);
    expect(sec2.isHardware).toBe(true);
  });
  it('cascades on delete', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: 'S' });
    const sp = createSpace(db, { sectionId: sec.id, name: '空间' });
    createLineItem(db, { spaceId: sp.id, snapshot: snap });
    deleteProject(db, pj.id);
    expect(db.prepare('SELECT COUNT(*) AS c FROM line_items').get()).toMatchObject({ c: 0 });
  });
  it('updates pricing fields on line item', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: 'S' });
    const sp = createSpace(db, { sectionId: sec.id, name: 'K' });
    const item = createLineItem(db, { spaceId: sp.id, snapshot: snap });
    const u = updateLineItem(db, item.id, { manualUnitPriceCents: 575713, marginOverride: null });
    expect(u.manualUnitPriceCents).toBe(575713);
  });
  it('creates project with projectType and round-trips it', () => {
    const pj = createProject(db, { name: '指挥中心项目', projectType: '指挥中心' });
    expect(pj.projectType).toBe('指挥中心');
    expect(getProject(db, pj.id)!.projectType).toBe('指挥中心');
  });
  it('defaults projectType to null when not provided', () => {
    const pj = createProject(db, { name: '无类型项目' });
    expect(pj.projectType).toBeNull();
  });
  it('updates projectType via updateProject', () => {
    const pj = createProject(db, { name: 'X' });
    const u = updateProject(db, pj.id, { projectType: '展厅' });
    expect(u.projectType).toBe('展厅');
    const cleared = updateProject(db, pj.id, { projectType: null });
    expect(cleared.projectType).toBeNull();
  });
  it('tolerates explicitly-undefined patch fields (binds as null)', () => {
    const pj = createProject(db, { name: 'X', client: '客户A' });
    const u = updateProject(db, pj.id, { client: undefined });
    expect(u.client).toBeNull();
    const sec = createSection(db, { projectId: pj.id, name: 'S' });
    const sp = createSpace(db, { sectionId: sec.id, name: 'K', area: 10 });
    const su = updateSpace(db, sp.id, { area: undefined });
    expect(su.area).toBeNull();
    const item = createLineItem(db, { spaceId: sp.id, snapshot: snap, remark: '备注' });
    const iu = updateLineItem(db, item.id, { remark: undefined });
    expect(iu.remark).toBeNull();
  });
  it('section v8 fields default to null/null/false when not provided', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: 'S' });
    expect(sec.subtotalLabel).toBeNull();
    expect(sec.feeLabel).toBeNull();
    expect(sec.linkSpaces).toBe(false);
  });
  it('section v8 fields round-trip via create and fetch', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: 'S', subtotalLabel: '硬件小计', feeLabel: '集成费', linkSpaces: true });
    expect(sec.subtotalLabel).toBe('硬件小计');
    expect(sec.feeLabel).toBe('集成费');
    expect(sec.linkSpaces).toBe(true);
    const fetched = listSections(db, pj.id)[0];
    expect(fetched.subtotalLabel).toBe('硬件小计');
    expect(fetched.feeLabel).toBe('集成费');
    expect(fetched.linkSpaces).toBe(true);
  });
  it('section v8 fields can be updated', () => {
    const pj = createProject(db, { name: 'X' });
    const sec = createSection(db, { projectId: pj.id, name: 'S' });
    const updated = updateSection(db, sec.id, { subtotalLabel: '新小计', feeLabel: '新费用', linkSpaces: true });
    expect(updated.subtotalLabel).toBe('新小计');
    expect(updated.feeLabel).toBe('新费用');
    expect(updated.linkSpaces).toBe(true);
    const cleared = updateSection(db, sec.id, { subtotalLabel: null, feeLabel: null, linkSpaces: false });
    expect(cleared.subtotalLabel).toBeNull();
    expect(cleared.feeLabel).toBeNull();
    expect(cleared.linkSpaces).toBe(false);
  });
});
