import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../../src/core/db/db';
import { createProduct, getProduct, listProducts, updateProduct, deleteProduct, suggestBrands, listWatchedProducts, setWatchPrice } from '../../src/core/repo/products';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });

const led = {
  category: 'LED屏', name: 'P1.8室内全彩LED屏', brand: '洲明', model: 'P1.8',
  unit: '㎡', power220W: 800, netPorts: 0,
  recommendedBrands: ['洲明','利亚德','强力巨彩'],
  options: [{ name: '防眩光', addPriceCents: 40000 }],
};

describe('products repo', () => {
  it('creates with JSON fields round-trip', () => {
    const p = createProduct(db, led);
    const got = getProduct(db, p.id)!;
    expect(got.recommendedBrands).toEqual(['洲明','利亚德','强力巨彩']);
    expect(got.options[0].addPriceCents).toBe(40000);
    expect(got.power220W).toBe(800);
  });
  it('filters by category and keyword', () => {
    createProduct(db, led);
    createProduct(db, { category: '音响', name: '壁挂全频音响', unit: '只' });
    expect(listProducts(db, { category: 'LED屏' })).toHaveLength(1);
    expect(listProducts(db, { keyword: '音响' })).toHaveLength(1);
    expect(listProducts(db)).toHaveLength(2);
  });
  it('updates and deletes', () => {
    const p = createProduct(db, led);
    const u = updateProduct(db, p.id, { model: 'P2.0' });
    expect(u.model).toBe('P2.0');
    deleteProduct(db, p.id);
    expect(getProduct(db, p.id)).toBeNull();
  });
});

describe('products repo：多分类标签', () => {
  it('用 categories 创建：category 兼容字段回填为 categories[0]', () => {
    const p = createProduct(db, { categories: ['LED屏', '55寸'], name: 'P1.8全彩屏', unit: '㎡' });
    expect(p.categories).toEqual(['LED屏', '55寸']);
    expect(p.category).toBe('LED屏');
    const got = getProduct(db, p.id)!;
    expect(got.categories).toEqual(['LED屏', '55寸']);
  });

  it('仅用旧版 category 创建：categories 回退为单元素数组', () => {
    const p = createProduct(db, { category: '音响', name: '壁挂全频音响', unit: '只' });
    expect(p.categories).toEqual(['音响']);
    expect(p.category).toBe('音响');
  });

  it('categories 与 category 同时给出时 categories 优先，但保留指定的 category 作为兼容字段', () => {
    const p = createProduct(db, { category: '设备类别', categories: ['LED屏', '55寸'], name: 'X', unit: '台' });
    expect(p.categories).toEqual(['LED屏', '55寸']);
    expect(p.category).toBe('设备类别');
  });

  it('listProducts 按 category 过滤：命中 categories 数组中的任一标签', () => {
    createProduct(db, { categories: ['LED屏', '55寸'], name: 'A', unit: '台' });
    createProduct(db, { categories: ['LED屏', '65寸'], name: 'B', unit: '台' });
    createProduct(db, { categories: ['音响'], name: 'C', unit: '只' });

    expect(listProducts(db, { category: 'LED屏' })).toHaveLength(2);
    expect(listProducts(db, { category: '55寸' })).toHaveLength(1);
    expect(listProducts(db, { category: '65寸' })).toHaveLength(1);
    expect(listProducts(db, { category: '音响' })).toHaveLength(1);
    expect(listProducts(db, { category: '不存在的分类' })).toHaveLength(0);
  });

  it('listProducts 按 category 过滤：兼容仅有旧 category 字段（无 categories）的产品', () => {
    createProduct(db, { category: '音响', name: '壁挂全频音响', unit: '只' });
    expect(listProducts(db, { category: '音响' })).toHaveLength(1);
  });

  it('updateProduct 传 categories 时整体替换，并同步 category 为 categories[0]', () => {
    const p = createProduct(db, { categories: ['LED屏', '55寸'], name: 'A', unit: '台' });
    const u = updateProduct(db, p.id, { categories: ['音响', '壁挂'] });
    expect(u.categories).toEqual(['音响', '壁挂']);
    expect(u.category).toBe('音响');
  });

  it('updateProduct 不传 category/categories 时分类保持不变', () => {
    const p = createProduct(db, { categories: ['LED屏', '55寸'], name: 'A', unit: '台' });
    const u = updateProduct(db, p.id, { model: 'M2' });
    expect(u.categories).toEqual(['LED屏', '55寸']);
    expect(u.category).toBe('LED屏');
  });

  it('categories 传入含重复/空白项时去重并去空白', () => {
    const p = createProduct(db, { categories: [' LED屏 ', 'LED屏', '', '  '], name: 'A', unit: '台' });
    expect(p.categories).toEqual(['LED屏']);
  });
});

describe('suggestBrands', () => {
  it('同分类命中：自身品牌 + 同分类产品的其他 distinct 品牌（最多2个，去重）', () => {
    createProduct(db, { categories: ['LED屏'], name: 'A', brand: '洲明', unit: '台' });
    createProduct(db, { categories: ['LED屏'], name: 'B', brand: '利亚德', unit: '台' });
    createProduct(db, { categories: ['LED屏'], name: 'C', brand: '强力巨彩', unit: '台' });
    createProduct(db, { categories: ['LED屏'], name: 'D', brand: '洲明', unit: '台' }); // 与已选重复，应跳过
    const result = suggestBrands(db, { brand: '雷曼', categories: ['LED屏'] });
    expect(result).toEqual(['雷曼', '洲明', '利亚德']);
  });

  it('不足2个可用其他品牌时按实际数量返回', () => {
    createProduct(db, { categories: ['音响'], name: 'X', brand: '博士', unit: '只' });
    const result = suggestBrands(db, { brand: 'JBL', categories: ['音响'] });
    expect(result).toEqual(['JBL', '博士']);
  });

  it('无 brand 时仅返回库内（同分类）品牌', () => {
    createProduct(db, { categories: ['音响'], name: 'X', brand: '博士', unit: '只' });
    createProduct(db, { categories: ['音响'], name: 'Y', brand: 'JBL', unit: '只' });
    const result = suggestBrands(db, { brand: null, categories: ['音响'] });
    expect(result).toEqual(['博士', 'JBL']);
  });

  it('categories 任一交集即命中（多分类标签）', () => {
    createProduct(db, { categories: ['LED屏', '55寸'], name: 'A', brand: '洲明', unit: '台' });
    const result = suggestBrands(db, { brand: null, categories: ['65寸', '55寸'] });
    expect(result).toEqual(['洲明']);
  });

  it('排除指定产品自身（excludeProductId），不把自己算作同分类的其他产品', () => {
    const self = createProduct(db, { categories: ['音响'], name: 'Self', brand: '雅马哈', unit: '只' });
    createProduct(db, { categories: ['音响'], name: 'Other', brand: '博士', unit: '只' });
    const result = suggestBrands(db, { brand: '雅马哈', categories: ['音响'], excludeProductId: self.id });
    expect(result).toEqual(['雅马哈', '博士']);
  });

  it('无分类、无品牌、无匹配产品时返回空数组', () => {
    expect(suggestBrands(db, { brand: null, categories: [] })).toEqual([]);
    expect(suggestBrands(db, { brand: '', categories: ['不存在分类'] })).toEqual([]);
  });
});

describe('products repo：价格监控字段', () => {
  it('watchPrice 往返：创建时传 true/false，读出保持一致', () => {
    const p1 = createProduct(db, { name: '监控产品', unit: '台', watchPrice: true });
    expect(p1.watchPrice).toBe(true);
    const got1 = getProduct(db, p1.id);
    expect(got1!.watchPrice).toBe(true);

    const p2 = createProduct(db, { name: '未监控产品', unit: '台', watchPrice: false });
    expect(p2.watchPrice).toBe(false);
    const got2 = getProduct(db, p2.id);
    expect(got2!.watchPrice).toBe(false);

    const p3 = createProduct(db, { name: '默认产品', unit: '台' });
    expect(p3.watchPrice).toBe(false); // 默认不监控
    const got3 = getProduct(db, p3.id);
    expect(got3!.watchPrice).toBe(false);
  });

  it('updateProduct 改 watchPrice：传入布尔值覆盖原值', () => {
    const p = createProduct(db, { name: 'X', unit: '台', watchPrice: false });
    expect(p.watchPrice).toBe(false);
    const u1 = updateProduct(db, p.id, { watchPrice: true });
    expect(u1.watchPrice).toBe(true);
    const u2 = updateProduct(db, p.id, { watchPrice: false });
    expect(u2.watchPrice).toBe(false);
  });

  it('listWatchedProducts：仅返回 watchPrice=true 的产品', () => {
    createProduct(db, { name: '监控A', unit: '台', watchPrice: true });
    createProduct(db, { name: '未监控B', unit: '台', watchPrice: false });
    createProduct(db, { name: '监控C', unit: '台', watchPrice: true });
    createProduct(db, { name: '默认D', unit: '台' });

    const watched = listWatchedProducts(db);
    expect(watched).toHaveLength(2);
    expect(watched.map((p) => p.name)).toEqual(['监控A', '监控C']);
    expect(watched.every((p) => p.watchPrice === true)).toBe(true);
  });

  it('setWatchPrice：批量设置产品监控状态，返回更新数', () => {
    const p1 = createProduct(db, { name: 'A', unit: '台', watchPrice: false });
    const p2 = createProduct(db, { name: 'B', unit: '台', watchPrice: false });
    const p3 = createProduct(db, { name: 'C', unit: '台', watchPrice: true });

    // 启用监控：A 和 B
    const count1 = setWatchPrice(db, [p1.id, p2.id], true);
    expect(count1).toBe(2);
    expect(getProduct(db, p1.id)!.watchPrice).toBe(true);
    expect(getProduct(db, p2.id)!.watchPrice).toBe(true);
    expect(getProduct(db, p3.id)!.watchPrice).toBe(true); // C 保持不变

    // 禁用监控：C
    const count2 = setWatchPrice(db, [p3.id], false);
    expect(count2).toBe(1);
    expect(getProduct(db, p3.id)!.watchPrice).toBe(false);
  });

  it('setWatchPrice：空数组返回 0，不执行更新', () => {
    const count = setWatchPrice(db, [], true);
    expect(count).toBe(0);
  });

  it('setWatchPrice：非存在的产品 id 静默忽略，返回实际更新数', () => {
    const p = createProduct(db, { name: 'A', unit: '台', watchPrice: false });
    const count = setWatchPrice(db, [p.id, 99999], true);
    expect(count).toBe(1); // 仅 p 被更新
    expect(getProduct(db, p.id)!.watchPrice).toBe(true);
  });
});
