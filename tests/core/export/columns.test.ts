import { describe, it, expect } from 'vitest';
import {
  BUDGET_COLUMNS, PRICING_COLUMNS, TENDER_COLUMNS, resolveColumns, colLetter, modeConfig,
  type ColumnDef,
} from '../../../src/core/export/columns';
import { FACTORY_CONFIG } from '../../../src/core/export/factoryTemplate';

/**
 * 出厂三版本列集经 resolveColumns 后与原 columnsForVariant 输出一致——
 * variants/columnsForVariant 机制已随重构删除，以下用例改写为对 resolveColumns 的等价断言。
 */
function versionCols(modeCols: ColumnDef[], versionKey: 'full' | 'external' | 'implementation'): ColumnDef[] {
  const version = FACTORY_CONFIG.versions.find(v => v.key === versionKey)!;
  return resolveColumns(modeCols, version.columns);
}

describe('resolveColumns equivalence with legacy columnsForVariant (BUDGET_COLUMNS)', () => {
  it('full version keeps all 18 columns in order', () => {
    const cols = versionCols(BUDGET_COLUMNS, 'full');
    expect(cols.map(c => c.key)).toEqual([
      'xh','name','params','unit','qty','unitPrice','total','remark','dims',
      'costUnit','costTotal','power220','power380','rackU','seqPower','netPorts','comPorts','ratio',
    ]);
  });
  it('external version cuts after remark', () => {
    const cols = versionCols(BUDGET_COLUMNS, 'external');
    expect(cols.map(c => c.key)).toEqual(['xh','name','params','unit','qty','unitPrice','total','remark']);
  });
  it('implementation version drops price columns keeps tech', () => {
    const keys = versionCols(BUDGET_COLUMNS, 'implementation').map(c => c.key);
    expect(keys).not.toContain('unitPrice');
    expect(keys).not.toContain('costUnit');
    expect(keys).not.toContain('ratio');
    expect(keys).toContain('power220');
    expect(keys).toContain('comPorts');
  });
  it('colLetter shifts with version', () => {
    expect(colLetter(versionCols(BUDGET_COLUMNS, 'full'), 'total')).toBe('G');
    expect(colLetter(versionCols(BUDGET_COLUMNS, 'implementation'), 'power220')).toBe('H');
    expect(() => colLetter(versionCols(BUDGET_COLUMNS, 'external'), 'costUnit')).toThrow();
  });
  it('text columns wrap and left-align; number columns right-align; xh/unit center', () => {
    const byKey = Object.fromEntries(BUDGET_COLUMNS.map(c => [c.key, c]));
    for (const k of ['params', 'name', 'remark', 'dims']) {
      expect(byKey[k].align).toBe('left');
      expect(byKey[k].wrap).toBe(true);
    }
    for (const k of ['qty', 'unitPrice', 'total', 'costUnit', 'costTotal', 'ratio', 'power220', 'power380', 'rackU', 'seqPower', 'netPorts', 'comPorts']) {
      expect(byKey[k].align).toBe('right');
    }
    expect(byKey.xh.align).toBe('center');
    expect(byKey.unit.align).toBe('center');
    expect(byKey.params.width).toBe(45);
    expect(byKey.name.width).toBe(28);
  });
});

describe('PRICING_COLUMNS', () => {
  it('same as BUDGET plus brands column after remark, header 招标参数', () => {
    const full = versionCols(PRICING_COLUMNS, 'full');
    expect(full.map(c => c.key)).toEqual([
      'xh','name','params','unit','qty','unitPrice','total','remark','brands','dims',
      'costUnit','costTotal','power220','power380','rackU','seqPower','netPorts','comPorts','ratio',
    ]);
    const byKey = Object.fromEntries(PRICING_COLUMNS.map(c => [c.key, c]));
    expect(byKey.params.header).toBe('招标参数');
    expect(byKey.brands.header).toBe('推荐品牌');
    expect(byKey.brands.align).toBe('left');
    expect(byKey.brands.wrap).toBe(true);
  });
});

describe('TENDER_COLUMNS', () => {
  it('trimmed column set through remark plus cost columns, no dims/tech, header 投标参数', () => {
    const full = versionCols(TENDER_COLUMNS, 'full');
    expect(full.map(c => c.key)).toEqual([
      'xh','name','params','unit','qty','unitPrice','total','remark','costUnit','costTotal','ratio',
    ]);
    const byKey = Object.fromEntries(TENDER_COLUMNS.map(c => [c.key, c]));
    expect(byKey.params.header).toBe('投标参数');
    for (const k of ['dims', 'power220', 'power380', 'rackU', 'seqPower', 'netPorts', 'comPorts']) {
      expect(byKey[k]).toBeUndefined();
    }
    const impl = versionCols(TENDER_COLUMNS, 'implementation').map(c => c.key);
    expect(impl).toEqual(['xh','name','params','unit','qty','remark']);
  });
});

describe('modeConfig', () => {
  it('budget -> BUDGET_COLUMNS/paramsCore/方案预算', () => {
    const c = modeConfig('budget');
    expect(c.columns).toBe(BUDGET_COLUMNS);
    expect(c.paramsField).toBe('paramsCore');
    expect(c.label).toBe('方案预算');
  });
  it('pricing -> PRICING_COLUMNS/paramsBid/造价清单', () => {
    const c = modeConfig('pricing');
    expect(c.columns).toBe(PRICING_COLUMNS);
    expect(c.paramsField).toBe('paramsBid');
    expect(c.label).toBe('造价清单');
  });
  it('tender -> TENDER_COLUMNS/paramsTender/投标造价清单', () => {
    const c = modeConfig('tender');
    expect(c.columns).toBe(TENDER_COLUMNS);
    expect(c.paramsField).toBe('paramsTender');
    expect(c.label).toBe('投标造价清单');
  });
  it('estimate throws friendly error', () => {
    expect(() => modeConfig('estimate')).toThrow('概算模式导出将在后续版本支持');
  });
});

describe('resolveColumns', () => {
  it('keeps template column order for the intersection, overrides label/width', () => {
    const modeCols: ColumnDef[] = [
      { key: 'xh', header: '序号', width: 6 },
      { key: 'name', header: '项目名称', width: 28 },
      { key: 'total', header: '合计', width: 14 },
    ];
    const out = resolveColumns(modeCols, [
      { key: 'total', label: '总价', width: 20 },
      { key: 'xh', label: null, width: null },
    ]);
    expect(out.map(c => c.key)).toEqual(['total', 'xh']);
    expect(out[0].header).toBe('总价');
    expect(out[0].width).toBe(20);
    expect(out[1].header).toBe('序号');
    expect(out[1].width).toBe(6);
  });
  it('silently skips template columns absent from the mode column set (budget has no brands)', () => {
    const out = resolveColumns(BUDGET_COLUMNS, [
      { key: 'xh', label: null, width: null },
      { key: 'brands', label: null, width: null },
      { key: 'name', label: null, width: null },
    ]);
    expect(out.map(c => c.key)).toEqual(['xh', 'name']);
  });

  it('custom- prefixed columns bypass modeCols and always render (label/width/fixedText passthrough)', () => {
    const out = resolveColumns(BUDGET_COLUMNS, [
      { key: 'xh', label: null, width: null },
      { key: 'custom-1', label: '厂家备注', width: 20, fixedText: '内部专供' },
      { key: 'name', label: null, width: null },
    ]);
    expect(out.map(c => c.key)).toEqual(['xh', 'custom-1', 'name']);
    const custom = out[1];
    expect(custom.header).toBe('厂家备注');
    expect(custom.width).toBe(20);
    expect(custom.align).toBe('left');
    expect((custom as any).fixedText).toBe('内部专供');
  });

  it('custom column without width defaults to 12, without fixedText defaults to null', () => {
    const out = resolveColumns(BUDGET_COLUMNS, [
      { key: 'custom-2', label: '空列', width: null },
    ]);
    expect(out[0].width).toBe(12);
    expect((out[0] as any).fixedText).toBeNull();
  });
});
