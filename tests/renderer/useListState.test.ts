import { describe, it, expect } from 'vitest';
import { mergeCategories } from '../../src/renderer/src/useListState';

describe('mergeCategories', () => {
  it('去重保序合并两个数组', () => {
    expect(mergeCategories(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('保留 cur 的原有顺序，追加项按 add 顺序补充', () => {
    expect(mergeCategories(['x', 'y'], ['z', 'y', 'w'])).toEqual(['x', 'y', 'z', 'w']);
  });

  it('cur 为空时返回 add 去重结果', () => {
    expect(mergeCategories([], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('add 为空时返回 cur 去重结果', () => {
    expect(mergeCategories(['a', 'a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('两者皆空返回空数组', () => {
    expect(mergeCategories([], [])).toEqual([]);
  });

  it('cur 内部重复也会被去重', () => {
    expect(mergeCategories(['a', 'a'], ['a'])).toEqual(['a']);
  });
});
