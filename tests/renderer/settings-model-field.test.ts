import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/renderer/src/pages/Settings.tsx', 'utf8');

describe('Settings AI model field layout', () => {
  it('binds the model Form.Item directly to the AutoComplete input inside the compact control', () => {
    const labelIndex = source.indexOf('label="模型名"');
    const buttonIndex = source.indexOf('获取官方模型', labelIndex);
    const modelBlock = source.slice(labelIndex, buttonIndex);

    expect(modelBlock).toContain('<Space.Compact');
    expect(modelBlock).toContain('name="model"');
    expect(modelBlock).toContain('noStyle');
    expect(modelBlock.indexOf('name="model"')).toBeGreaterThan(modelBlock.indexOf('<Space.Compact'));
    expect(modelBlock.indexOf('name="model"')).toBeLessThan(modelBlock.indexOf('<AutoComplete'));
  });
});
