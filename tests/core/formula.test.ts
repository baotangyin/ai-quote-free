import { describe, it, expect } from 'vitest';
import { evaluateFormula } from '../../src/core/domain/formula';

describe('基本四则与优先级', () => {
  it('2+3*4 = 14', () => { expect(evaluateFormula('2+3*4', {})).toBe(14); });
  it('(2+3)*4 = 20', () => { expect(evaluateFormula('(2+3)*4', {})).toBe(20); });
  it('10/4 = 2.5', () => { expect(evaluateFormula('10/4', {})).toBe(2.5); });
  it('10-2-3 = 5 (左结合)', () => { expect(evaluateFormula('10-2-3', {})).toBe(5); });
  it('20/2/5 = 2 (左结合)', () => { expect(evaluateFormula('20/2/5', {})).toBe(2); });
  it('忽略空白 1 +  2 * 3 = 7', () => { expect(evaluateFormula('1 +  2 * 3', {})).toBe(7); });
});

describe('一元负号', () => {
  it('-5+2 = -3', () => { expect(evaluateFormula('-5+2', {})).toBe(-3); });
  it('3*-2 = -6', () => { expect(evaluateFormula('3*-2', {})).toBe(-6); });
  it('-(2+3) = -5', () => { expect(evaluateFormula('-(2+3)', {})).toBe(-5); });
  it('--3 = 3', () => { expect(evaluateFormula('--3', {})).toBe(3); });
});

describe('数字字面量', () => {
  it('整数 270000', () => { expect(evaluateFormula('270000', {})).toBe(270000); });
  it('小数 1.2', () => { expect(evaluateFormula('1.2', {})).toBe(1.2); });
  it('小数 0.05', () => { expect(evaluateFormula('0.05', {})).toBe(0.05); });
  it('前导点 .5', () => { expect(evaluateFormula('.5', {})).toBe(0.5); });
});

describe('变量', () => {
  it('area*2 with {area:3} = 6', () => { expect(evaluateFormula('area*2', { area: 3 })).toBe(6); });
  it('power*1.2 with {power:100} = 120', () => { expect(evaluateFormula('power*1.2', { power: 100 })).toBeCloseTo(120); });
  it('下划线变量 _x + x1', () => { expect(evaluateFormula('_x + x1', { _x: 10, x1: 5 })).toBe(15); });
});

describe('函数', () => {
  it('ceil(2.1) = 3', () => { expect(evaluateFormula('ceil(2.1)', {})).toBe(3); });
  it('floor(2.9) = 2', () => { expect(evaluateFormula('floor(2.9)', {})).toBe(2); });
  it('round(2.5) = 3', () => { expect(evaluateFormula('round(2.5)', {})).toBe(3); });
  it('abs(-4) = 4', () => { expect(evaluateFormula('abs(-4)', {})).toBe(4); });
  it('min(3,5,1) = 1', () => { expect(evaluateFormula('min(3,5,1)', {})).toBe(1); });
  it('max(3,5,1) = 5', () => { expect(evaluateFormula('max(3,5,1)', {})).toBe(5); });
  it('min(7) = 7 (单参)', () => { expect(evaluateFormula('min(7)', {})).toBe(7); });
  it('嵌套 ceil(area*270000/512) with {area:10} = 5274', () => {
    expect(evaluateFormula('ceil(area*270000/512)', { area: 10 })).toBe(5274);
  });
  it('ceil(power*1.2/300) with {power:5000} = 20', () => {
    expect(evaluateFormula('ceil(power*1.2/300)', { power: 5000 })).toBe(20);
  });
});

describe('领域示例', () => {
  it('area*0.06 with {area:73.73} ≈ 4.4238', () => {
    expect(evaluateFormula('area*0.06', { area: 73.73 })).toBeCloseTo(4.4238, 4);
  });
});

describe('错误处理', () => {
  it('空串抛错', () => { expect(() => evaluateFormula('', {})).toThrow(); });
  it('只有空白抛错', () => { expect(() => evaluateFormula('   ', {})).toThrow(); });
  it('2+ 抛错', () => { expect(() => evaluateFormula('2+', {})).toThrow(); });
  it('(2+3 抛错 (括号不匹配)', () => { expect(() => evaluateFormula('(2+3', {})).toThrow(); });
  it('2+3) 抛错 (括号不匹配)', () => { expect(() => evaluateFormula('2+3)', {})).toThrow(); });
  it('1/0 抛错含除以零', () => { expect(() => evaluateFormula('1/0', {})).toThrow(/除以零|division by zero/i); });
  it('foo+1 未定义变量抛错含变量名', () => {
    expect(() => evaluateFormula('foo+1', {})).toThrow(/foo/);
  });
  it('bar(2) 未知函数抛错', () => { expect(() => evaluateFormula('bar(2)', {})).toThrow(/bar/); });
  it('3@4 非法字符抛错', () => { expect(() => evaluateFormula('3@4', {})).toThrow(); });
  it('50%2 非法字符抛错', () => { expect(() => evaluateFormula('50%2', {})).toThrow(); });
  it('ceil(1,2) 参数过多抛错', () => { expect(() => evaluateFormula('ceil(1,2)', {})).toThrow(); });
  it('abs() 零参抛错', () => { expect(() => evaluateFormula('abs()', {})).toThrow(); });
  it('min() 零参抛错', () => { expect(() => evaluateFormula('min()', {})).toThrow(); });
  it('大写函数 CEIL(1) 未知函数抛错', () => { expect(() => evaluateFormula('CEIL(1.2)', {})).toThrow(); });
  it('超长公式抛错含公式过长', () => {
    const long = '1' + '+1'.repeat(600); // 长度 > 1000
    expect(() => evaluateFormula(long, {})).toThrow(/公式过长/);
  });
  it('深层嵌套括号抛错而非栈溢出', () => {
    const deep = '('.repeat(300) + '1' + ')'.repeat(300);
    expect(() => evaluateFormula(deep, {})).toThrow(/嵌套过深/);
  });
});
