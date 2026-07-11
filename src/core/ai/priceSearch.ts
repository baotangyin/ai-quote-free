import type { Db } from '../db/db';
import { nowIso } from '../db/db';
import type { ChatMessage } from './client';
import { extractJson } from './json';
import type { VisionChatFn } from '../import/drawingRecognize';
import type { Product, Cents, CostRule } from '../domain/types';
import { listWatchedProducts } from '../repo/products';
import { addPriceRecord, getEffectiveCost } from '../repo/prices';

export interface PriceSearchResult {
  found: boolean;
  priceCents: Cents | null;
  sourceUrl: string | null;
  note: string | null;
}

export interface WatchRoundAlert {
  productId: number;
  name: string;
  oldCents: Cents;
  newCents: Cents;
  changeRate: number;
}

export interface WatchRoundSummary {
  checked: number;
  updated: number;
  failed: number;
  skipped: number;
  alerts: WatchRoundAlert[];
  finishedAt: string;
}

const MAX_TOKENS = 1000;
/** 单产品价格 >20 倍或 <1/20 历史有效成本时判定为疑似幻觉，护栏丢弃。 */
const GUARD_RATIO = 20;
/** 每个产品之间的查询间隔（毫秒），避免请求过于密集。测试中传 0。 */
const DEFAULT_DELAY_MS = 3000;

/**
 * 构造联网查价提示词（中文）：要求严格 JSON，禁止编造价格。
 * 输出结构：{"found": boolean, "priceYuan": 数字或null, "sourceUrl": 字符串或null, "note": 字符串或null}
 * priceYuan 为人民币元（非分），元→分换算在调用方（searchPrice）以 Math.round(priceYuan*100) 完成。
 */
export function buildPriceSearchPrompt(product: Product): string {
  const specParts = [
    product.brand ? `品牌：${product.brand}` : null,
    product.model ? `型号：${product.model}` : null,
    product.dims ? `规格：${product.dims}` : null,
    `计价单位：${product.unit}`,
    product.paramsCore ? `核心参数：${product.paramsCore}` : null,
  ].filter((s): s is string => !!s);

  return [
    '你是专业的弱电智能化工程设备市场询价助手，具备联网搜索能力。',
    `任务：搜索以下设备当前的市场采购单价（人民币，元/${product.unit}），并输出严格的 JSON 对象，不要输出任何解释性文字，不要使用 Markdown 代码围栏。`,
    '',
    `设备名称：${product.name}`,
    ...specParts,
    '',
    '输出结构：{"found": true/false, "priceYuan": 数字或null, "sourceUrl": 字符串或null, "note": 字符串或null}',
    '',
    '规则：',
    '1. 只有在能找到具体、可信的价格来源时才输出 found=true 及对应的 priceYuan（数字，单位：元）、sourceUrl（价格来源链接）。',
    '2. 找不到可靠来源、无法确认真实价格时，必须输出 found=false，priceYuan 和 sourceUrl 均为 null，禁止编造或估算价格。',
    '3. note 用于补充说明（如价格来源描述、找不到的原因），没有可留 null。',
    '4. 严格输出 JSON 对象，不要有多余文字、不要使用 Markdown 代码围栏。',
  ].join('\n');
}

function toNullableString(v: unknown): string | null {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/** 将 AI 返回的已解析 JSON 校验、归一化为 PriceSearchResult；结构非法时抛错（由调用方计入 failed）。 */
function toPriceSearchResult(parsed: unknown): PriceSearchResult {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('AI输出格式非法');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.found !== 'boolean') {
    throw new Error('AI输出格式非法');
  }
  if (!obj.found) {
    return { found: false, priceCents: null, sourceUrl: null, note: toNullableString(obj.note) };
  }
  if (typeof obj.priceYuan !== 'number' || !Number.isFinite(obj.priceYuan)) {
    throw new Error('AI输出格式非法');
  }
  const priceCents = Math.round(obj.priceYuan * 100);
  return {
    found: true,
    priceCents,
    sourceUrl: toNullableString(obj.sourceUrl),
    note: toNullableString(obj.note),
  };
}

/**
 * 对单个产品发起一次联网查价请求。
 * chat 调用失败、AI 输出无法解析为 JSON、或结构非法均会抛出异常，由调用方（runPriceWatchRound）
 * 捕获并计入 failed，不在此处吞掉——这样才能与 found=false（AI 明确表示查不到，计入 skipped）区分开。
 */
export async function searchPrice(chat: VisionChatFn, product: Product): Promise<PriceSearchResult> {
  const prompt = buildPriceSearchPrompt(product);
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const text = await chat(messages, { maxTokens: MAX_TOKENS });
  const parsed = extractJson(text);
  return toPriceSearchResult(parsed);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 整轮价格监控：遍历所有启用监控的产品，逐个（间隔 delayMs，默认 3s）联网查价。
 *
 * 分类逻辑：
 * - found=false（AI 明确表示查不到，非编造）→ skipped++，不入库。
 * - found=true 但未通过防幻觉护栏（priceYuan 非正；或存在历史有效成本时新价 >20 倍或 <1/20）
 *   → failed++，不入库。
 * - found=true 且通过护栏 → addPriceRecord(source:'ai_search') 入库 → updated++；
 *   异动判定以「插入前」的 getEffectiveCost 为基线，old 为 null（无历史记录）时不判定异动。
 * - chat 抛异常 / JSON 解析失败 / 结构非法 → failed++，不中断整轮，继续下一个产品。
 */
export async function runPriceWatchRound(
  db: Db,
  chat: VisionChatFn,
  opts: { costRule: CostRule; alertRate: number; delayMs?: number },
): Promise<WatchRoundSummary> {
  const products = listWatchedProducts(db);
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  let updated = 0;
  let failed = 0;
  let skipped = 0;
  const alerts: WatchRoundAlert[] = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    try {
      const result = await searchPrice(chat, product);
      if (!result.found) {
        skipped++;
      } else {
        const priceCents = result.priceCents as Cents;
        // 异动判定 / 护栏基线：插入前的历史有效成本。
        const oldCents = getEffectiveCost(db, product.id, opts.costRule);
        const hasValidHistory = oldCents !== null && oldCents > 0;

        const nonPositive = priceCents <= 0;
        const guardTripped =
          hasValidHistory &&
          (priceCents > (oldCents as number) * GUARD_RATIO || priceCents < (oldCents as number) / GUARD_RATIO);

        if (nonPositive || guardTripped) {
          failed++;
        } else {
          addPriceRecord(db, {
            productId: product.id,
            source: 'ai_search',
            priceCents,
            sourceUrl: result.sourceUrl ?? undefined,
            capturedAt: nowIso(),
          });
          updated++;

          if (hasValidHistory) {
            const changeRate = Math.abs(priceCents - (oldCents as number)) / (oldCents as number);
            if (changeRate >= opts.alertRate) {
              alerts.push({
                productId: product.id,
                name: product.name,
                oldCents: oldCents as number,
                newCents: priceCents,
                changeRate,
              });
            }
          }
        }
      }
    } catch {
      failed++;
    }

    if (i < products.length - 1) {
      await sleep(delayMs);
    }
  }

  return { checked: products.length, updated, failed, skipped, alerts, finishedAt: nowIso() };
}
