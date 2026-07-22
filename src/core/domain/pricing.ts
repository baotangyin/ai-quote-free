import type { LineItem, Project, Section, RoundRule, Cents } from './types';

export function roundCents(cents: number, rule: RoundRule): Cents {
  if (rule === 'cent') return Math.round(cents);
  const unit = rule === 'yuan' ? 100 : 1000;
  return Math.round(cents / unit) * unit;
}

export function unitPriceCents(item: LineItem, project: Project): Cents {
  if (item.manualUnitPriceCents != null) return item.manualUnitPriceCents;
  const margin = item.marginOverride ?? project.defaultMargin;
  return roundCents(item.snapshot.costUnitCents * margin, project.roundRule);
}

export interface LineTotals { unitPriceCents: Cents; totalCents: Cents; costTotalCents: Cents; ratio: number | null }

export function lineTotals(item: LineItem, project: Project): LineTotals {
  const unit = unitPriceCents(item, project);
  const totalCents = Math.round(unit * item.qty);
  const costTotalCents = Math.round(item.snapshot.costUnitCents * item.qty);
  const ratio = item.snapshot.costUnitCents > 0 ? unit / item.snapshot.costUnitCents : null;
  return { unitPriceCents: unit, totalCents, costTotalCents, ratio };
}

export interface TechTotals { power220W: number; power380W: number; rackU: number; seqPowerPorts: number; netPorts: number; comPorts: number }

export function techTotals(items: LineItem[]): TechTotals {
  const acc: TechTotals = { power220W: 0, power380W: 0, rackU: 0, seqPowerPorts: 0, netPorts: 0, comPorts: 0 };
  for (const it of items) {
    acc.power220W += it.snapshot.power220W * it.qty;
    acc.power380W += it.snapshot.power380W * it.qty;
    acc.rackU += it.snapshot.rackU * it.qty;
    acc.seqPowerPorts += it.snapshot.seqPowerPorts * it.qty;
    acc.netPorts += it.snapshot.netPorts * it.qty;
    acc.comPorts += it.snapshot.comPorts * it.qty;
  }
  return acc;
}

export function spaceSubtotal(items: LineItem[], project: Project): { totalCents: Cents; costTotalCents: Cents } {
  let totalCents = 0, costTotalCents = 0;
  for (const it of items) {
    const r = lineTotals(it, project);
    totalCents += r.totalCents; costTotalCents += r.costTotalCents;
  }
  return { totalCents, costTotalCents };
}

export interface SectionTotals {
  equipmentCents: Cents; integrationFeeCents: Cents; totalCents: Cents;
  costTotalCents: Cents; tech: TechTotals;
}

export function sectionTotals(spaces: { items: LineItem[] }[], section: Section, project: Project): SectionTotals {
  let equipmentCents = 0, costTotalCents = 0;
  const allItems: LineItem[] = [];
  for (const sp of spaces) {
    const st = spaceSubtotal(sp.items, project);
    equipmentCents += st.totalCents; costTotalCents += st.costTotalCents;
    allItems.push(...sp.items);
  }
  const integrationFeeCents = roundCents(equipmentCents * section.integrationFeeRate, project.roundRule);
  return { equipmentCents, integrationFeeCents,
    totalCents: equipmentCents + integrationFeeCents,
    costTotalCents, tech: techTotals(allItems) };
}

export function projectTotals(sections: SectionTotals[]): { totalCents: Cents; costTotalCents: Cents; profitCents: Cents } {
  let totalCents = 0, costTotalCents = 0;
  for (const s of sections) { totalCents += s.totalCents; costTotalCents += s.costTotalCents; }
  return { totalCents, costTotalCents, profitCents: totalCents - costTotalCents };
}
