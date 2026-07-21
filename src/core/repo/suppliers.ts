import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { Supplier } from '../domain/types';

function rowToSupplier(r: any): Supplier {
  return {
    id: r.id, name: r.name, contact: r.contact, note: r.note,
    phone: r.phone, address: r.address, paymentTerms: r.payment_terms, bankInfo: r.bank_info,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface SupplierInput {
  name: string;
  contact?: string | null;
  note?: string | null;
  phone?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  bankInfo?: string | null;
}

export function createSupplier(db: Db, input: SupplierInput): Supplier {
  const t = nowIso();
  const info = db.prepare(
    `INSERT INTO suppliers (name, contact, note, phone, address, payment_terms, bank_info, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    input.name, input.contact ?? null, input.note ?? null,
    input.phone ?? null, input.address ?? null, input.paymentTerms ?? null, input.bankInfo ?? null,
    t, t
  );
  return getSupplier(db, Number(info.lastInsertRowid))!;
}

export function getSupplier(db: Db, id: number): Supplier | null {
  const r = db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);
  return r ? rowToSupplier(r) : null;
}

export function listSuppliers(db: Db): Supplier[] {
  return db.prepare('SELECT * FROM suppliers ORDER BY id').all().map(rowToSupplier);
}

export function updateSupplier(db: Db, id: number, patch: Partial<SupplierInput>): Supplier {
  const cur = getSupplier(db, id);
  if (!cur) throw new Error(`supplier ${id} not found`);
  db.prepare(
    `UPDATE suppliers SET name=?, contact=?, note=?, phone=?, address=?, payment_terms=?, bank_info=?, updated_at=? WHERE id=?`
  ).run(
    patch.name ?? cur.name,
    patch.contact !== undefined ? patch.contact : cur.contact,
    patch.note !== undefined ? patch.note : cur.note,
    patch.phone !== undefined ? patch.phone : cur.phone,
    patch.address !== undefined ? patch.address : cur.address,
    patch.paymentTerms !== undefined ? patch.paymentTerms : cur.paymentTerms,
    patch.bankInfo !== undefined ? patch.bankInfo : cur.bankInfo,
    nowIso(), id
  );
  return getSupplier(db, id)!;
}

export function deleteSupplier(db: Db, id: number): void {
  db.prepare('DELETE FROM suppliers WHERE id=?').run(id);
}
