import { describe, it, expect } from 'vitest';
import type { Product } from '../../src/core/domain/types';

describe('scaffold', () => {
  it('types are importable', () => {
    const p: Partial<Product> = { name: 'LED屏', unit: '㎡' };
    expect(p.name).toBe('LED屏');
  });
});
