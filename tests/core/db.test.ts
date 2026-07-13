import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/core/db/db';

describe('db', () => {
  it('opens in-memory db with all tables', () => {
    const db = openDb(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name);
    for (const t of ['suppliers','products','price_records','projects','sections','spaces','line_items'])
      expect(tables).toContain(t);
    db.close();
  });
  it('enforces foreign keys', () => {
    const db = openDb(':memory:');
    expect(() => db.prepare(
      "INSERT INTO price_records (product_id, source, price_cents, captured_at, created_at, updated_at) VALUES (999,'manual',100,'2026-01-01','x','x')"
    ).run()).toThrow();
    db.close();
  });
});
