import type { Db } from '../db/db';
import { createProduct, suggestBrands } from '../repo/products';
import { addPriceRecord } from '../repo/prices';
import { applyCategoryDefaults } from '../repo/categoryTemplates';
import type { PriceSource } from '../domain/types';
import type { RecognizedRow } from './recognize';

export type CommitRow = RecognizedRow & { action: 'create' | 'updatePrice'; productId?: number };

/**
 * 落库：action='create' 建产品 + 落价格记录；action='updatePrice' 仅落价格记录（不重复建档）。
 * 价格来源：supplierId 非空时为 'supplier'，否则为 'manual'。
 * action='create' 行的 recommendedBrands 为空时，自动调用 suggestBrands 按品牌+分类补齐推荐品牌。
 */
export function commitRows(
  db: Db,
  supplierId: number | null,
  rows: CommitRow[],
): { created: number; priced: number } {
  const source: PriceSource = supplierId != null ? 'supplier' : 'manual';
  let created = 0;
  let priced = 0;

  for (const row of rows) {
    let productId: number;

    if (row.action === 'create') {
      const recommendedBrands =
        row.recommendedBrands && row.recommendedBrands.length > 0
          ? row.recommendedBrands
          : suggestBrands(db, { brand: row.brand, categories: row.categories });
      const filled = applyCategoryDefaults(db, row.categories, {
        unit: row.unit,
        paramsCore: row.params,
        paramsBid: undefined,
        paramsTender: undefined,
        power220W: row.power220W ?? undefined,
        power380W: row.power380W ?? undefined,
        rackU: row.rackU ?? undefined,
        seqPowerPorts: row.seqPowerPorts ?? undefined,
        netPorts: row.netPorts ?? undefined,
        comPorts: row.comPorts ?? undefined,
      });
      const product = createProduct(db, {
        categories: row.categories,
        name: row.name,
        brand: row.brand,
        model: row.model,
        recommendedBrands,
        paramsCore: filled.paramsCore,
        paramsBid: filled.paramsBid,
        paramsTender: filled.paramsTender,
        unit: filled.unit,
        dims: row.dims,
        power220W: filled.power220W,
        power380W: filled.power380W,
        rackU: filled.rackU,
        seqPowerPorts: filled.seqPowerPorts,
        netPorts: filled.netPorts,
        comPorts: filled.comPorts,
        options: row.options.map((o) => ({
          name: o.name,
          addPriceCents: o.addPriceCents,
          ...(o.paramsText ? { paramsText: o.paramsText } : {}),
        })),
      });
      productId = product.id;
      created++;
    } else {
      if (row.productId == null) {
        throw new Error('updatePrice 行缺少 productId');
      }
      productId = row.productId;
    }

    addPriceRecord(db, {
      productId,
      source,
      priceCents: row.priceCents,
      supplierId: supplierId ?? undefined,
    });
    priced++;
  }

  return { created, priced };
}
