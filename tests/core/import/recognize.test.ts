import { describe, it, expect, vi } from 'vitest';
import {
  buildPrompt,
  chunkGrid,
  validateRecognizedRows,
  recognizeSheet,
  type RecognizedRow,
} from '../../../src/core/import/recognize';
import type { AiConfig } from '../../../src/core/ai/client';

describe('buildPrompt', () => {
  const grid = [
    ['名称', '型号', '售价'],
    ['显示器', 'X100', '1000'],
  ];
  const messages = buildPrompt('拼接屏', grid);

  it('返回 system + user 两条消息', () => {
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('system 消息含关键识别指令', () => {
    const sys = messages[0].content;
    expect(sys).toContain('另加');
    expect(sys).toContain('矩阵定价');
    expect(sys).toContain('展开为多行');
    expect(sys).toContain('confidence');
    expect(sys).toContain('price_yuan');
    expect(sys).toContain('options');
    expect(sys).toContain('add_price_yuan');
    expect(sys).toContain('JSON 数组');
    expect(sys).toContain('没有价格的行');
    expect(sys).toContain('压缩至200字以内');
    expect(sys).toContain('power_220w');
    expect(sys).toContain('power_380w');
    expect(sys).toContain('rack_u');
    expect(sys).toContain('seq_power_ports');
    expect(sys).toContain('net_ports');
    expect(sys).toContain('com_ports');
    expect(sys).toContain('380V');
    expect(sys).toContain('三相');
    expect(sys).toContain('功率电压待确认');
  });

  it('user 消息含 sheet 名与 grid 的 TSV 文本', () => {
    const user = messages[1].content;
    expect(user).toContain('拼接屏');
    expect(user).toContain('名称\t型号\t售价');
    expect(user).toContain('显示器\tX100\t1000');
  });
});

describe('chunkGrid', () => {
  it('未超过 maxRows 且未超过 maxChars 时不分块，原样返回', () => {
    const grid = [
      ['名称', '型号', '售价'],
      ['A', '1', '100'],
      ['B', '2', '200'],
    ];
    expect(chunkGrid(grid, { maxRows: 60 })).toEqual([grid]);
  });

  it('超长表按行分块，表头行复制到每块首部', () => {
    const header = ['名称', '型号', '售价'];
    const bodyRows = Array.from({ length: 10 }, (_, i) => [`产品${i}`, `M${i}`, `${i * 100}`]);
    const grid = [header, ...bodyRows];

    const chunks = chunkGrid(grid, { maxRows: 4 });

    expect(chunks).toHaveLength(3); // 10 body rows / 4 per chunk -> 3 chunks
    for (const chunk of chunks) {
      expect(chunk[0]).toEqual(header);
    }
    expect(chunks[0]).toEqual([header, ...bodyRows.slice(0, 4)]);
    expect(chunks[1]).toEqual([header, ...bodyRows.slice(4, 8)]);
    expect(chunks[2]).toEqual([header, ...bodyRows.slice(8, 10)]);
  });

  it('表头启发式只看前 3 行', () => {
    const bodyRows = Array.from({ length: 6 }, (_, i) => [`产品${i}`, `${i * 10}`]);
    // 表头关键词行放在第 4 行（index 3），不应被识别为表头
    const grid = [['a', 'b'], ['c', 'd'], ['e', 'f'], ['名称', '价格'], ...bodyRows];
    const chunks = chunkGrid(grid, { maxRows: 3 });
    // 没有识别出表头行，所有 9 行都作为 body 参与分块
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0][0]).not.toEqual(['名称', '价格']);
  });

  it('默认 maxRows=25、maxChars=6000，未超过时不分块', () => {
    const grid = [
      ['名称', '型号', '售价'],
      ['A', '1', '100'],
    ];
    expect(chunkGrid(grid)).toEqual([grid]);
  });

  it('长参数行（每行约1000字符）按字符预算自动切成小块，即使远未达到 maxRows', () => {
    const header = ['名称', '型号', '参数', '售价'];
    const longParam = '规格描述'.repeat(250); // 中文字符，每行接近 1000+ 字符
    const bodyRows = Array.from({ length: 10 }, (_, i) => [`产品${i}`, `M${i}`, longParam, `${i * 100}`]);
    const grid = [header, ...bodyRows];

    // 10 行远小于默认 maxRows(25)，但总字符量远超默认 maxChars(6000)，应按字符预算切块
    const chunks = chunkGrid(grid);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk[0]).toEqual(header); // 表头复制到每块首部
      const bodyRowCount = chunk.length - 1;
      expect(bodyRowCount).toBeGreaterThanOrEqual(1); // 每块最少 1 行数据
      const chars = chunk.map((r) => r.join('\t')).join('\n').length;
      // 单行本身若超过 maxChars，允许该块单独超限（每块最少1行的约束优先）；
      // 但多行块的总字符量不应显著超过预算过多。
      if (bodyRowCount > 1) {
        expect(chars).toBeLessThanOrEqual(6000 + longParam.length);
      }
    }

    // 所有块拼接起来的数据行应覆盖全部 10 行且顺序不变
    const allBodyRows = chunks.flatMap((c) => c.slice(1));
    expect(allBodyRows).toEqual(bodyRows);
  });

  it('maxChars 与 maxRows 双约束：先到为准', () => {
    const header = ['名称', '售价'];
    const bodyRows = Array.from({ length: 5 }, (_, i) => [`产品${i}`, `${i * 100}`]);
    const grid = [header, ...bodyRows];

    // maxRows=2 比 maxChars 更早触发，应按 2 行一块切分
    const chunks = chunkGrid(grid, { maxRows: 2, maxChars: 6000 });
    expect(chunks).toHaveLength(3); // 2,2,1
    expect(chunks[0]).toEqual([header, ...bodyRows.slice(0, 2)]);
    expect(chunks[1]).toEqual([header, ...bodyRows.slice(2, 4)]);
    expect(chunks[2]).toEqual([header, ...bodyRows.slice(4, 5)]);
  });
});

describe('validateRecognizedRows', () => {
  const validRow = {
    category: '显示设备',
    name: '46寸拼接屏',
    brand: '海康',
    model: 'X100',
    params: '46寸 1920x1080',
    unit: '台',
    dims: '1000x600',
    price_yuan: 1000,
    options: [{ name: '防爆屏', add_price_yuan: 400 }],
    remark: '备注',
    confidence: 0.9,
  };

  it('合法行：price_yuan 转 priceCents，options 转 addPriceCents', () => {
    const { rows, dropped } = validateRecognizedRows([validRow]);
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.priceCents).toBe(100000);
    expect(row.options).toEqual([{ name: '防爆屏', addPriceCents: 40000 }]);
    expect(row.brand).toBe('海康');
    expect(row.confidence).toBe(0.9);
  });

  it('缺少必填字段（name）的行丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, name: undefined }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('缺少必填字段（category）的行丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, category: '' }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('价格字符串（如"4,500元"）清洗为数字后入库', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: '4,500元' }]);
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(450000);
  });

  it('无法清洗出数字的价格字符串丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: '面议' }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('负价丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: -100 }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('0 价丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: 0 }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('"万"单位价格按 ×10000 元换算，而非清洗后按原数字入分', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: '1.5万' }]);
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(1500000);
  });

  it('"万元"单位同样按 ×10000 元换算', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: '3万元' }]);
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(3000000);
  });

  it('无法识别或歧义单位（如"K"/"w"）的价格字符串丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: '2K' }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('超大价格（超过一千亿元上限）丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([{ ...validRow, price_yuan: 1e13 }]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('超过 Number.MAX_SAFE_INTEGER 分的价格丢弃并计数', () => {
    const { rows, dropped } = validateRecognizedRows([
      { ...validRow, price_yuan: Number.MAX_SAFE_INTEGER },
    ]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('字符串字段统一 trim 后入 RecognizedRow', () => {
    const { rows } = validateRecognizedRows([
      {
        ...validRow,
        category: '  显示设备  ',
        name: '  46寸拼接屏  ',
        unit: '  台  ',
        brand: '  海康  ',
        model: '  X100  ',
        params: '  46寸 1920x1080  ',
        dims: '  1000x600  ',
        remark: '  备注  ',
        options: [{ name: '  防爆屏  ', add_price_yuan: 400 }],
      },
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.categories).toEqual(['显示设备']);
    expect(row.name).toBe('46寸拼接屏');
    expect(row.unit).toBe('台');
    expect(row.brand).toBe('海康');
    expect(row.model).toBe('X100');
    expect(row.params).toBe('46寸 1920x1080');
    expect(row.dims).toBe('1000x600');
    expect(row.remark).toBe('备注');
    expect(row.options[0].name).toBe('防爆屏');
  });

  it('非数组且非对象输入（如字符串）dropped 至少计 1', () => {
    const { rows, dropped } = validateRecognizedRows('not an object');
    expect(rows).toEqual([]);
    expect(dropped).toBeGreaterThanOrEqual(1);
  });

  it('非数组但为单个合法对象时按 [obj] 处理并救回', () => {
    const { rows, dropped } = validateRecognizedRows(validRow);
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(100000);
  });

  it('非数组但为单个非法对象时 dropped 至少计 1', () => {
    const { rows, dropped } = validateRecognizedRows({ ...validRow, name: '' });
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('confidence 缺省为 0.5', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, confidence: undefined }]);
    expect(rows[0].confidence).toBe(0.5);
  });

  it('confidence 超出范围时截断到 0~1', () => {
    const { rows: r1 } = validateRecognizedRows([{ ...validRow, confidence: 1.5 }]);
    expect(r1[0].confidence).toBe(1);
    const { rows: r2 } = validateRecognizedRows([{ ...validRow, confidence: -0.5 }]);
    expect(r2[0].confidence).toBe(0);
  });

  it('brand/model 缺省为 null', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, brand: undefined, model: null }]);
    expect(rows[0].brand).toBeNull();
    expect(rows[0].model).toBeNull();
  });

  it('options 缺省为空数组', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, options: undefined }]);
    expect(rows[0].options).toEqual([]);
  });

  it('options 中的 params 字段提取为 paramsText，没有则不带该字段', () => {
    const { rows } = validateRecognizedRows([
      {
        ...validRow,
        options: [
          { name: '防爆屏', add_price_yuan: 400, params: '  防爆等级IK10  ' },
          { name: '壁挂支架', add_price_yuan: 100 },
        ],
      },
    ]);
    expect(rows[0].options).toEqual([
      { name: '防爆屏', addPriceCents: 40000, paramsText: '防爆等级IK10' },
      { name: '壁挂支架', addPriceCents: 10000 },
    ]);
  });

  it('recommendedBrands 缺省为空数组，非法项过滤', () => {
    const { rows: r1 } = validateRecognizedRows([{ ...validRow, recommendedBrands: undefined }]);
    expect(r1[0].recommendedBrands).toEqual([]);
    const { rows: r2 } = validateRecognizedRows([
      { ...validRow, recommendedBrands: ['海康', '', '  大华  ', 123] },
    ]);
    expect(r2[0].recommendedBrands).toEqual(['海康', '大华']);
  });

  it('非数组对象输入按单对象救回尝试，校验失败则 dropped 计 1', () => {
    const { rows, dropped } = validateRecognizedRows({ not: 'an array' });
    expect(rows).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('power_220w/power_380w 缺省为 null', () => {
    const { rows } = validateRecognizedRows([validRow]);
    expect(rows[0].power220W).toBeNull();
    expect(rows[0].power380W).toBeNull();
  });

  it('power_220w 标注 380V 设备的功率归 power380W，power220W 为 null', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, power_380w: 1500, power_220w: null }]);
    expect(rows[0].power380W).toBe(1500);
    expect(rows[0].power220W).toBeNull();
  });

  it('power_220w 为普通 220V 设备时归 power220W，power380W 为 null', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, power_220w: 80, power_380w: null }]);
    expect(rows[0].power220W).toBe(80);
    expect(rows[0].power380W).toBeNull();
  });

  it('power_220w/power_380w 为可清洗数字的字符串时正常解析', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, power_220w: '80W' }]);
    expect(rows[0].power220W).toBe(80);
  });

  it('power_220w/power_380w 无法识别的值按 null 处理', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, power_220w: '未知' }]);
    expect(rows[0].power220W).toBeNull();
  });

  it('rack_u/seq_power_ports/net_ports/com_ports 缺省为 null', () => {
    const { rows } = validateRecognizedRows([validRow]);
    expect(rows[0].rackU).toBeNull();
    expect(rows[0].seqPowerPorts).toBeNull();
    expect(rows[0].netPorts).toBeNull();
    expect(rows[0].comPorts).toBeNull();
  });

  it('rack_u/seq_power_ports/net_ports/com_ports 为整数时正常解析', () => {
    const { rows } = validateRecognizedRows([
      { ...validRow, rack_u: 4, seq_power_ports: 2, net_ports: 8, com_ports: 1 },
    ]);
    expect(rows[0].rackU).toBe(4);
    expect(rows[0].seqPowerPorts).toBe(2);
    expect(rows[0].netPorts).toBe(8);
    expect(rows[0].comPorts).toBe(1);
  });

  it('rack_u 等字段为可清洗为整数的字符串时正常解析', () => {
    const { rows } = validateRecognizedRows([{ ...validRow, rack_u: '4U' }]);
    expect(rows[0].rackU).toBe(4);
  });

  it('rack_u 等字段为非整数（小数/无法识别）时按 null 处理，不臆测', () => {
    const { rows: r1 } = validateRecognizedRows([{ ...validRow, rack_u: 4.5 }]);
    expect(r1[0].rackU).toBeNull();
    const { rows: r2 } = validateRecognizedRows([{ ...validRow, seq_power_ports: '未知' }]);
    expect(r2[0].seqPowerPorts).toBeNull();
  });
});

describe('recognizeSheet', () => {
  const cfg: AiConfig = { protocol: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' };

  it('分块串行调用注入的 chatFn，合并两块识别结果', async () => {
    const header = ['名称', '型号', '售价'];
    const bodyRows = Array.from({ length: 8 }, (_, i) => [`产品${i}`, `M${i}`, `${(i + 1) * 100}`]);
    const grid = [header, ...bodyRows];

    const chunk1Json = JSON.stringify([
      { category: 'A类', name: '产品0', brand: null, model: 'M0', params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.8 },
    ]);
    const chunk2Json = JSON.stringify([
      { category: 'A类', name: '产品5', brand: null, model: 'M5', params: null, unit: '台', dims: null, price_yuan: 600, options: [], remark: null, confidence: 0.7 },
    ]);

    const chatFn = vi.fn()
      .mockResolvedValueOnce(chunk1Json)
      .mockResolvedValueOnce(chunk2Json);

    const { rows, dropped } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn, maxRows: 4 });

    expect(chatFn).toHaveBeenCalledTimes(2);
    // 串行：第二次调用发生在第一次 resolve 之后（mock 顺序已由 mockResolvedValueOnce 保证）
    expect(dropped).toBe(0);
    expect(rows.map((r: RecognizedRow) => r.name)).toEqual(['产品0', '产品5']);
    expect(rows[0].priceCents).toBe(10000);
    expect(rows[1].priceCents).toBe(60000);
  });

  it('单块（未超过 maxRows）时只调用一次 chatFn', async () => {
    const grid = [
      ['名称', '型号', '售价'],
      ['产品A', 'M1', '100'],
    ];
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify([
      { category: 'A类', name: '产品A', brand: null, model: 'M1', params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.9 },
    ]));
    const { rows } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn });
    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it('AI 输出中的非法行会被丢弃并累加计数', async () => {
    const grid = [
      ['名称', '型号', '售价'],
      ['产品A', 'M1', '100'],
    ];
    const chatFn = vi.fn().mockResolvedValue(JSON.stringify([
      { category: 'A类', name: '产品A', brand: null, model: 'M1', params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.9 },
      { category: '', name: '', unit: '' }, // 非法行
    ]));
    const { rows, dropped } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn });
    expect(rows).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('单块解析失败（chatFn 抛错）且该块只有 1 行数据：不重试，直接计入 failedChunks，其余块正常合并', async () => {
    const header = ['名称', '型号', '售价'];
    // 5 body rows, maxRows=4 -> chunk1: 4 rows（成功），chunk2: 1 row（失败，不足 2 行不重试）
    const bodyRows = Array.from({ length: 5 }, (_, i) => [`产品${i}`, `M${i}`, `${(i + 1) * 100}`]);
    const grid = [header, ...bodyRows];

    const chunk1Json = JSON.stringify([
      { category: 'A类', name: '产品0', brand: null, model: 'M0', params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.8 },
    ]);

    const chatFn = vi.fn()
      .mockResolvedValueOnce(chunk1Json)
      .mockRejectedValueOnce(new Error('AI 调用失败'));

    const { rows, dropped, failedChunks, truncatedChunks } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn, maxRows: 4 });

    expect(chatFn).toHaveBeenCalledTimes(2); // 第二块只有 1 行数据，不触发对半重试
    expect(rows.map((r: RecognizedRow) => r.name)).toEqual(['产品0']);
    expect(dropped).toBe(0);
    expect(failedChunks).toBe(1);
    expect(truncatedChunks).toBe(0);
  });

  it('extractJson 抛错（非法 JSON）且该块只有 1 行数据：同样计入 failedChunks，不影响其余块', async () => {
    const header = ['名称', '型号', '售价'];
    const bodyRows = Array.from({ length: 5 }, (_, i) => [`产品${i}`, `M${i}`, `${(i + 1) * 100}`]);
    const grid = [header, ...bodyRows];

    const chunk1Json = JSON.stringify([
      { category: 'A类', name: '产品0', brand: null, model: 'M0', params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.8 },
    ]);

    const chatFn = vi.fn()
      .mockResolvedValueOnce(chunk1Json)
      .mockResolvedValueOnce('这不是合法 JSON，也没有可提取的花括号或方括号');

    const { rows, failedChunks } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn, maxRows: 4 });

    expect(rows.map((r: RecognizedRow) => r.name)).toEqual(['产品0']);
    expect(failedChunks).toBe(1);
  });

  it('单块失败且数据行数 >1：对半拆成两个子块各重试一次，子块成功计入 rows、子块失败计入 failedChunks', async () => {
    const header = ['名称', '型号', '售价'];
    const bodyRows = [
      ['产品0', 'M0', '100'],
      ['产品1', 'M1', '200'],
    ];
    const grid = [header, ...bodyRows]; // 2 body rows, 单块（不超过默认 maxRows/maxChars）

    const subChunkJson = JSON.stringify([
      { category: 'A类', name: '产品0', brand: null, model: 'M0', params: null, unit: '台', dims: null, price_yuan: 100, options: [], remark: null, confidence: 0.8 },
    ]);

    const chatFn = vi.fn()
      .mockRejectedValueOnce(new Error('第一次整体调用失败')) // 整块调用失败
      .mockResolvedValueOnce(subChunkJson) // 子块1（产品0）成功
      .mockRejectedValueOnce(new Error('子块2 也失败')); // 子块2（产品1）失败

    const { rows, failedChunks, truncatedChunks } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn });

    expect(chatFn).toHaveBeenCalledTimes(3); // 整块 1 次 + 对半重试 2 次
    expect(rows.map((r: RecognizedRow) => r.name)).toEqual(['产品0']);
    expect(failedChunks).toBe(1); // 只有子块2 失败
    expect(truncatedChunks).toBe(0);
  });

  it('单块输出被截断但能抢救出前 N 个完整行：抢救行数正确入 rows，truncatedChunks=1，不计入 failedChunks', async () => {
    const header = ['名称', '型号', '售价'];
    const bodyRows = [
      ['产品0', 'M0', '100'],
      ['产品1', 'M1', '200'],
      ['产品2', 'M2', '300'],
    ];
    const grid = [header, ...bodyRows];

    const row = (name: string, model: string, price: number): string =>
      JSON.stringify({ category: 'A类', name, brand: null, model, params: null, unit: '台', dims: null, price_yuan: price, options: [], remark: null, confidence: 0.8 });

    // 模拟被截断的数组输出：前两个对象完整，第三个对象在中途被截断（无结尾 ] ）
    const truncatedJson = `[${row('产品0', 'M0', 100)},${row('产品1', 'M1', 200)},{"category":"A类","name":"产品2","brand":null,"model":"M2","params":"未完成的参数描述`;

    const chatFn = vi.fn().mockResolvedValueOnce(truncatedJson);

    const { rows, dropped, failedChunks, truncatedChunks } = await recognizeSheet(cfg, 'sheet1', grid, { chatFn });

    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(rows.map((r: RecognizedRow) => r.name)).toEqual(['产品0', '产品1']);
    expect(dropped).toBe(0);
    expect(failedChunks).toBe(0);
    expect(truncatedChunks).toBe(1);
  });
});
