import type { Db, Project, Section, Space, LineItem, LineTotals, SectionTotals, Cents } from '../index';
import { getProject, listSections, listSpaces, listLineItems, lineTotals, spaceSubtotal, sectionTotals } from '../index';

export interface ExportItem { item: LineItem; lt: LineTotals }
export interface ExportSpace { space: Space; items: ExportItem[]; subtotal: { totalCents: Cents; costTotalCents: Cents } }
export interface ExportSection { section: Section; spaces: ExportSpace[]; totals: SectionTotals }
export interface ExportModel { project: Project; sections: ExportSection[] }

export function assembleExportModel(db: Db, projectId: number): ExportModel {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const sections: ExportSection[] = listSections(db, projectId).map(section => {
    const spaces: ExportSpace[] = listSpaces(db, section.id).map(space => {
      const items = listLineItems(db, space.id).map(item => ({ item, lt: lineTotals(item, project) }));
      return { space, items, subtotal: spaceSubtotal(items.map(i => i.item), project) };
    });
    const totals = sectionTotals(spaces.map(s => ({ items: s.items.map(i => i.item) })), section, project);
    return { section, spaces, totals };
  });
  return { project, sections };
}

const CN = ['零','一','二','三','四','五','六','七','八','九'];

export function cnOrdinal(n: number): string {
  if (n < 1 || n > 99) throw new Error(`cnOrdinal out of range: ${n}`);
  if (n < 10) return CN[n];
  const tens = Math.floor(n / 10), ones = n % 10;
  return (tens === 1 ? '十' : CN[tens] + '十') + (ones ? CN[ones] : '');
}
