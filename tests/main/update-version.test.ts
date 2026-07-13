import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../src/main/updateVersion';

describe('isNewerVersion', () => {
  it('latest 大于 current 时返回 true', () => {
    expect(isNewerVersion('0.16.0', '0.15.0')).toBe(true);
  });

  it('latest 等于 current 时返回 false', () => {
    expect(isNewerVersion('0.15.0', '0.15.0')).toBe(false);
  });

  it('latest 小于 current 时返回 false', () => {
    expect(isNewerVersion('0.14.0', '0.15.0')).toBe(false);
  });

  it('忽略 v 前缀', () => {
    expect(isNewerVersion('v0.16.0', '0.15.0')).toBe(true);
    expect(isNewerVersion('0.16.0', 'v0.15.0')).toBe(true);
  });

  it('按 major/minor/patch 逐级比较', () => {
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.16.1', '0.16.0')).toBe(true);
    expect(isNewerVersion('0.16.0', '0.16.1')).toBe(false);
    expect(isNewerVersion('0.2.0', '0.16.0')).toBe(false);
  });

  it('忽略预发布/构建元数据后缀，只比较核心三段', () => {
    expect(isNewerVersion('0.16.0-beta.1', '0.15.0')).toBe(true);
    expect(isNewerVersion('0.16.0+build123', '0.16.0')).toBe(false);
    expect(isNewerVersion('0.16.0-beta.1', '0.16.0')).toBe(false);
  });

  it('无法解析的分段按 0 处理，不抛错', () => {
    expect(() => isNewerVersion('abc', '0.15.0')).not.toThrow();
    expect(isNewerVersion('abc', '0.15.0')).toBe(false);
    expect(isNewerVersion('', '')).toBe(false);
    expect(isNewerVersion('1.x.0', '1.0.0')).toBe(false);
  });

  it('缺失分段按 0 处理', () => {
    expect(isNewerVersion('1.1', '1.0.5')).toBe(true);
    expect(isNewerVersion('1', '0.99.99')).toBe(true);
  });
});
