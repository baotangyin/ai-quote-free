import { describe, it, expect } from 'vitest';
import { extractJson, extractJsonLenient } from '../../../src/core/ai/json';

describe('extractJson', () => {
  it('解析裸 JSON 对象', () => {
    expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });

  it('解析裸 JSON 数组', () => {
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('剥离 ```json 围栏', () => {
    const text = '```json\n{"a":1}\n```';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it('剥离不带语言标注的 ``` 围栏', () => {
    const text = '```\n{"a":2}\n```';
    expect(extractJson(text)).toEqual({ a: 2 });
  });

  it('忽略前后噪声文字，截取首个 { 到配对末尾', () => {
    const text = '这是识别结果：\n{"rows":[{"name":"甲"}]}\n以上是全部内容。';
    expect(extractJson(text)).toEqual({ rows: [{ name: '甲' }] });
  });

  it('忽略前后噪声文字，截取首个 [ 到配对末尾', () => {
    const text = '结果如下\n[{"x":1},{"x":2}]\n谢谢';
    expect(extractJson(text)).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it('嵌套括号与字符串内含 ]} 不干扰配对', () => {
    const text =
      '前言\n{"note":"含有 ]} 的字符串","nested":{"list":[1,2,{"k":"v"}]}}\n后记';
    expect(extractJson(text)).toEqual({
      note: '含有 ]} 的字符串',
      nested: { list: [1, 2, { k: 'v' }] },
    });
  });

  it('非法输入抛出「AI输出无法解析」', () => {
    expect(() => extractJson('这不是 JSON，也没有花括号或方括号')).toThrow(
      'AI输出无法解析',
    );
  });

  it('花括号未配对时抛出「AI输出无法解析」', () => {
    expect(() => extractJson('{"a": 1')).toThrow('AI输出无法解析');
  });

  it('花括号内容不是合法 JSON 时抛出「AI输出无法解析」', () => {
    expect(() => extractJson('{a: 1,}')).toThrow('AI输出无法解析');
  });
});

describe('extractJsonLenient', () => {
  it('完整数组：与 extractJson 结果一致，truncated 为 false', () => {
    const text = '[{"a":1},{"a":2}]';
    expect(extractJsonLenient(text)).toEqual({ value: [{ a: 1 }, { a: 2 }], truncated: false });
  });

  it('截断在对象中间：抢救出前 N 个完整对象，truncated 为 true', () => {
    const text = '[{"a":1},{"a":2},{"a":3,"b":"未完';
    expect(extractJsonLenient(text)).toEqual({
      value: [{ a: 1 }, { a: 2 }],
      truncated: true,
    });
  });

  it('截断在字符串内部：仍能抢救出前面的完整对象', () => {
    const text = '[{"name":"甲","note":"正常"},{"name":"乙","note":"这段字符串没有闭合';
    expect(extractJsonLenient(text)).toEqual({
      value: [{ name: '甲', note: '正常' }],
      truncated: true,
    });
  });

  it('完全垃圾输入抛出「AI输出无法解析」', () => {
    expect(() => extractJsonLenient('这不是 JSON，也没有花括号或方括号')).toThrow(
      'AI输出无法解析',
    );
  });

  it('截断发生在首个数组元素内（一个完整元素都没有）时抛错', () => {
    expect(() => extractJsonLenient('[{"a":1,"b":"未完')).toThrow('AI输出无法解析');
  });

  it('首个符号是 { （非数组）且不完整时直接抛错，不做抢救', () => {
    expect(() => extractJsonLenient('{"a":1,"b":"未完')).toThrow('AI输出无法解析');
  });
});
