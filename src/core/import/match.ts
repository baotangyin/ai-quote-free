import type { Db } from '../db/db';
import type { RecognizedRow } from './recognize';

export type MatchResult = { kind: 'existing'; productId: number } | { kind: 'new' };

/**
 * 产品匹配：先按 brand+model 精确匹配（两者均非空时才尝试），
 * 再按 name 全等匹配；均未命中则视为新产品。
 */
export function matchProduct(db: Db, row: RecognizedRow): MatchResult {
  if (row.brand && row.model) {
    const byBrandModel = db
      .prepare('SELECT id FROM products WHERE brand = ? AND model = ? LIMIT 1')
      .get(row.brand, row.model) as { id: number } | undefined;
    if (byBrandModel) {
      return { kind: 'existing', productId: byBrandModel.id };
    }
  }

  const byName = db
    .prepare('SELECT id FROM products WHERE name = ? LIMIT 1')
    .get(row.name) as { id: number } | undefined;
  if (byName) {
    return { kind: 'existing', productId: byName.id };
  }

  return { kind: 'new' };
}
