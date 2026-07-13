/**
 * 从 LLM 输出文本中提取 JSON。
 *
 * 支持：裸 JSON、```json 围栏（或不带语言标注的 ``` 围栏）、前后夹杂噪声文字。
 * 提取策略：找到首个 '{' 或 '['，从该位置开始做括号配对（忽略字符串内的括号与转义），
 * 截取到配对完成的位置，再交给 JSON.parse。
 *
 * 失败（找不到起始符号、括号未配对、JSON.parse 失败）一律抛出 Error('AI输出无法解析')。
 */
export function extractJson(text: string): unknown {
  const stripped = stripCodeFence(text);
  const candidate = sliceBalancedJson(stripped);
  if (candidate === null) {
    throw new Error('AI输出无法解析');
  }
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error('AI输出无法解析');
  }
}

/**
 * 宽容版 extractJson：优先走原逻辑，成功即返回 { value, truncated: false }。
 *
 * 若原逻辑失败（典型场景：LLM 输出因 token 预算耗尽被截断，数组括号未配对），
 * 且首个起始符号是 `[`（数组）：从截断处往回找最后一个能构成完整对象/元素的
 * `}`/`]`（字符串感知，复用与 sliceBalancedJson 相同的扫描方式：跳过字符串内的
 * 括号与转义），把文本截到该处、补上 `]` 再 parse，抢救出前 N 个完整元素，
 * 返回 { value, truncated: true }。
 *
 * 首个符号不是 `[`（如截断的裸对象）或抢救仍失败，一律抛出 Error('AI输出无法解析')。
 */
export function extractJsonLenient(text: string): { value: unknown; truncated: boolean } {
  try {
    return { value: extractJson(text), truncated: false };
  } catch {
    // fall through to rescue attempt below
  }

  const stripped = stripCodeFence(text);
  const rescued = rescueTruncatedArray(stripped);
  if (rescued !== null) {
    try {
      return { value: JSON.parse(rescued), truncated: true };
    } catch {
      // fall through to throw below
    }
  }

  throw new Error('AI输出无法解析');
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return fenceMatch[1];
  }
  return trimmed;
}

function sliceBalancedJson(text: string): string | null {
  let start = -1;
  let openChar = '';
  let closeChar = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      start = i;
      openChar = ch;
      closeChar = ch === '{' ? '}' : ']';
      break;
    }
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * 从（已解析 code fence 的）文本中定位首个 `[`，做字符串感知的括号栈扫描，
 * 记录每次「栈深度回落到 1」（即刚好闭合了数组的一个顶层元素）时的位置。
 * 扫描到文本末尾时，用最后一次记录的位置截断并补 `]`，抢救出前 N 个完整元素。
 *
 * 首个括号不是 `[`、或扫描过程中一个完整元素都未闭合（如第一个元素就被截断），
 * 返回 null。
 */
function rescueTruncatedArray(text: string): string | null {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      start = i;
      break;
    }
  }
  if (start === -1 || text[start] !== '[') return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastCompleteEnd = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      continue;
    }

    if (ch === '}' || ch === ']') {
      const expected = stack.pop();
      if (expected !== ch) {
        // 括号结构不匹配（垃圾/损坏内容），停止扫描，保留目前已抢救到的部分。
        break;
      }
      if (stack.length === 1) {
        // 栈中只剩最外层的 ']'，说明刚闭合了数组的一个顶层元素。
        lastCompleteEnd = i;
      } else if (stack.length === 0) {
        // 整个数组其实是配对完整的（extractJson 失败另有原因，如非法语法）。
        return text.slice(start, i + 1);
      }
    }
  }

  if (lastCompleteEnd === -1) return null;
  return text.slice(start, lastCompleteEnd + 1) + ']';
}
