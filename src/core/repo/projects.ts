import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { Project, Section, Space, LineItem, LineItemSnapshot, QuoteMode, RoundRule, Cents } from '../domain/types';

const toProject = (r: any): Project => ({ id: r.id, name: r.name, client: r.client,
  projectType: r.project_type ?? null,
  mode: r.mode, defaultMargin: r.default_margin, roundRule: r.round_rule, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at });
const toSection = (r: any): Section => ({ id: r.id, projectId: r.project_id, name: r.name,
  sortOrder: r.sort_order, integrationFeeRate: r.integration_fee_rate,
  isHardware: !!r.is_hardware, subtotalLabel: r.subtotal_label ?? null, feeLabel: r.fee_label ?? null,
  linkSpaces: !!r.link_spaces, createdAt: r.created_at, updatedAt: r.updated_at });
const toSpace = (r: any): Space => ({ id: r.id, sectionId: r.section_id, name: r.name,
  description: r.description, sortOrder: r.sort_order, area: r.area, pinBottom: !!r.pin_bottom,
  createdAt: r.created_at, updatedAt: r.updated_at });
const toItem = (r: any): LineItem => ({ id: r.id, spaceId: r.space_id, productId: r.product_id,
  snapshot: JSON.parse(r.snapshot), qty: r.qty, marginOverride: r.margin_override,
  manualUnitPriceCents: r.manual_unit_price_cents, remark: r.remark, imagePath: r.image_path,
  sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at });

export function createProject(db: Db, input: { name: string; client?: string; projectType?: string | null; mode?: QuoteMode; defaultMargin?: number; roundRule?: RoundRule }): Project {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO projects (name, client, project_type, mode, default_margin, round_rule, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?, 'draft', ?, ?)`).run(input.name, input.client ?? null, input.projectType ?? null,
    input.mode ?? 'budget', input.defaultMargin ?? 1.3, input.roundRule ?? 'yuan', t, t);
  return getProject(db, Number(info.lastInsertRowid))!;
}
export function getProject(db: Db, id: number): Project | null {
  const r = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  return r ? toProject(r) : null;
}
export function listProjects(db: Db): Project[] {
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(toProject);
}
export function updateProject(db: Db, id: number, patch: Partial<{ name: string; client: string | null; projectType: string | null; mode: QuoteMode; defaultMargin: number; roundRule: RoundRule; status: 'draft' | 'done' }>): Project {
  const cur = getProject(db, id); if (!cur) throw new Error(`project ${id} not found`);
  const m = { ...cur, ...patch };
  db.prepare('UPDATE projects SET name=?, client=?, project_type=?, mode=?, default_margin=?, round_rule=?, status=?, updated_at=? WHERE id=?')
    .run(m.name, m.client ?? null, m.projectType ?? null, m.mode, m.defaultMargin, m.roundRule, m.status, nowIso(), id);
  return getProject(db, id)!;
}
export function deleteProject(db: Db, id: number): void {
  db.prepare('DELETE FROM projects WHERE id=?').run(id);
}

function nextSort(db: Db, table: 'sections' | 'spaces' | 'line_items', fkCol: string, fkVal: number): number {
  const r = db.prepare(`SELECT COALESCE(MAX(sort_order)+1, 0) AS n FROM ${table} WHERE ${fkCol}=?`).get(fkVal) as any;
  return r.n;
}

export function createSection(db: Db, input: { projectId: number; name: string; integrationFeeRate?: number; isHardware?: boolean; subtotalLabel?: string | null; feeLabel?: string | null; linkSpaces?: boolean }): Section {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO sections (project_id, name, sort_order, integration_fee_rate, is_hardware, subtotal_label, fee_label, link_spaces, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(input.projectId, input.name,
    nextSort(db, 'sections', 'project_id', input.projectId),
    input.integrationFeeRate ?? 0, input.isHardware === false ? 0 : 1,
    input.subtotalLabel ?? null, input.feeLabel ?? null, input.linkSpaces ? 1 : 0, t, t);
  const r = db.prepare('SELECT * FROM sections WHERE id=?').get(Number(info.lastInsertRowid));
  return toSection(r);
}
export function listSections(db: Db, projectId: number): Section[] {
  return db.prepare('SELECT * FROM sections WHERE project_id=? ORDER BY sort_order').all(projectId).map(toSection);
}
export function updateSection(db: Db, id: number, patch: Partial<{ name: string; sortOrder: number; integrationFeeRate: number; isHardware: boolean; subtotalLabel: string | null; feeLabel: string | null; linkSpaces: boolean }>): Section {
  const r0 = db.prepare('SELECT * FROM sections WHERE id=?').get(id);
  if (!r0) throw new Error(`section ${id} not found`);
  const cur = toSection(r0); const m = { ...cur, ...patch };
  db.prepare('UPDATE sections SET name=?, sort_order=?, integration_fee_rate=?, is_hardware=?, subtotal_label=?, fee_label=?, link_spaces=?, updated_at=? WHERE id=?')
    .run(m.name, m.sortOrder, m.integrationFeeRate, m.isHardware ? 1 : 0, m.subtotalLabel ?? null, m.feeLabel ?? null, m.linkSpaces ? 1 : 0, nowIso(), id);
  return toSection(db.prepare('SELECT * FROM sections WHERE id=?').get(id));
}
export function deleteSection(db: Db, id: number): void {
  db.prepare('DELETE FROM sections WHERE id=?').run(id);
}

export function createSpace(db: Db, input: { sectionId: number; name: string; description?: string; area?: number; pinBottom?: boolean }): Space {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO spaces (section_id, name, description, sort_order, area, pin_bottom, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(input.sectionId, input.name, input.description ?? null,
    nextSort(db, 'spaces', 'section_id', input.sectionId), input.area ?? null, input.pinBottom ? 1 : 0, t, t);
  return toSpace(db.prepare('SELECT * FROM spaces WHERE id=?').get(Number(info.lastInsertRowid)));
}
export function listSpaces(db: Db, sectionId: number): Space[] {
  return db.prepare('SELECT * FROM spaces WHERE section_id=? ORDER BY pin_bottom, sort_order').all(sectionId).map(toSpace);
}
export function updateSpace(db: Db, id: number, patch: Partial<{ name: string; description: string | null; sortOrder: number; area: number | null; pinBottom: boolean }>): Space {
  const r0 = db.prepare('SELECT * FROM spaces WHERE id=?').get(id);
  if (!r0) throw new Error(`space ${id} not found`);
  const cur = toSpace(r0); const m = { ...cur, ...patch };
  db.prepare('UPDATE spaces SET name=?, description=?, sort_order=?, area=?, pin_bottom=?, updated_at=? WHERE id=?')
    .run(m.name, m.description ?? null, m.sortOrder, m.area ?? null, m.pinBottom ? 1 : 0, nowIso(), id);
  return toSpace(db.prepare('SELECT * FROM spaces WHERE id=?').get(id));
}
export function deleteSpace(db: Db, id: number): void {
  db.prepare('DELETE FROM spaces WHERE id=?').run(id);
}

export function createLineItem(db: Db, input: {
  spaceId: number; productId?: number; snapshot: LineItemSnapshot;
  qty?: number; marginOverride?: number; manualUnitPriceCents?: Cents;
  remark?: string; imagePath?: string;
}): LineItem {
  const t = nowIso();
  const info = db.prepare(`INSERT INTO line_items
    (space_id, product_id, snapshot, qty, margin_override, manual_unit_price_cents, remark, image_path, sort_order, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.spaceId, input.productId ?? null, JSON.stringify(input.snapshot),
    input.qty ?? 1, input.marginOverride ?? null, input.manualUnitPriceCents ?? null,
    input.remark ?? null, input.imagePath ?? null,
    nextSort(db, 'line_items', 'space_id', input.spaceId), t, t);
  return toItem(db.prepare('SELECT * FROM line_items WHERE id=?').get(Number(info.lastInsertRowid)));
}
export function getLineItem(db: Db, id: number): LineItem | null {
  const r = db.prepare('SELECT * FROM line_items WHERE id=?').get(id);
  return r ? toItem(r) : null;
}
export function listLineItems(db: Db, spaceId: number): LineItem[] {
  return db.prepare('SELECT * FROM line_items WHERE space_id=? ORDER BY sort_order').all(spaceId).map(toItem);
}
export function updateLineItem(db: Db, id: number, patch: Partial<{
  snapshot: LineItemSnapshot; qty: number; marginOverride: number | null;
  manualUnitPriceCents: Cents | null; remark: string | null; imagePath: string | null; sortOrder: number;
}>): LineItem {
  const cur = getLineItem(db, id); if (!cur) throw new Error(`line item ${id} not found`);
  const m = { ...cur, ...patch };
  db.prepare(`UPDATE line_items SET snapshot=?, qty=?, margin_override=?, manual_unit_price_cents=?,
    remark=?, image_path=?, sort_order=?, updated_at=? WHERE id=?`).run(
    JSON.stringify(m.snapshot), m.qty, m.marginOverride ?? null, m.manualUnitPriceCents ?? null,
    m.remark ?? null, m.imagePath ?? null, m.sortOrder, nowIso(), id);
  return getLineItem(db, id)!;
}
export function deleteLineItem(db: Db, id: number): void {
  db.prepare('DELETE FROM line_items WHERE id=?').run(id);
}
