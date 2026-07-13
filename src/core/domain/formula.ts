/**
 * 安全的算术表达式求值器（用于规则动作的「数量公式」）。
 *
 * 安全性：本模块**不使用** eval / new Function / 任何动态代码执行。
 * 采用自实现的 tokenizer + 递归下降解析器（parseExpr → parseTerm → parseFactor），
 * 边解析边构建 AST，再对 AST 求值。
 *
 * 支持文法：
 *   - 数字字面量（整数、小数、前导点小数）
 *   - 标识符（变量）：字母/下划线开头，后接字母数字下划线
 *   - 二元运算 + - * /（标准优先级，左结合）
 *   - 一元负号
 *   - 括号
 *   - 函数：ceil/floor/round/abs（单参），min/max（≥1 变参）
 */

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isIdentStart = (c: string) => c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c);

  while (i < n) {
    const c = expr[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
    if (c === ',') { tokens.push({ kind: 'comma' }); i++; continue; }
    if (isDigit(c) || c === '.') {
      let j = i;
      let dotCount = 0;
      while (j < n && (isDigit(expr[j]) || expr[j] === '.')) {
        if (expr[j] === '.') dotCount++;
        j++;
      }
      const text = expr.slice(i, j);
      if (dotCount > 1 || text === '.') {
        throw new Error(`非法数字字面量: ${text}`);
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new Error(`非法数字字面量: ${text}`);
      }
      tokens.push({ kind: 'number', value });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < n && isIdentPart(expr[j])) j++;
      tokens.push({ kind: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`非法字符: '${c}' (位置 ${i})`);
  }
  return tokens;
}

// AST 节点
type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'neg'; operand: Node }
  | { type: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] };

const SINGLE_ARG_FNS = new Set(['ceil', 'floor', 'round', 'abs']);
const VARARG_FNS = new Set(['min', 'max']);

/** 解析递归深度上限，防御性阻止深层嵌套括号/一元链导致的栈溢出（RangeError）。 */
const MAX_PARSE_DEPTH = 200;

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }

  parse(): Node {
    if (this.tokens.length === 0) throw new Error('空表达式');
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new Error('意外的 token：表达式解析未完成');
    }
    return node;
  }

  // 加减（左结合）
  private parseExpr(): Node {
    if (++this.depth > MAX_PARSE_DEPTH) throw new Error('公式嵌套过深');
    try {
      return this.parseExprInner();
    } finally {
      this.depth--;
    }
  }

  private parseExprInner(): Node {
    let left = this.parseTerm();
    let t = this.peek();
    while (t && t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      this.next();
      const right = this.parseTerm();
      left = { type: 'bin', op: t.value, left, right };
      t = this.peek();
    }
    return left;
  }

  // 乘除（左结合）
  private parseTerm(): Node {
    let left = this.parseFactor();
    let t = this.peek();
    while (t && t.kind === 'op' && (t.value === '*' || t.value === '/')) {
      this.next();
      const right = this.parseFactor();
      left = { type: 'bin', op: t.value, left, right };
      t = this.peek();
    }
    return left;
  }

  // 一元负、括号、数字、变量、函数调用
  private parseFactor(): Node {
    const t = this.peek();
    if (!t) throw new Error('意外结束：缺少操作数');

    if (t.kind === 'op' && t.value === '-') {
      this.next();
      return { type: 'neg', operand: this.parseFactor() };
    }
    if (t.kind === 'op' && t.value === '+') {
      // 一元正号，直接透传
      this.next();
      return this.parseFactor();
    }
    if (t.kind === 'number') {
      this.next();
      return { type: 'num', value: t.value };
    }
    if (t.kind === 'lparen') {
      this.next();
      const node = this.parseExpr();
      const close = this.next();
      if (!close || close.kind !== 'rparen') throw new Error('括号不匹配：缺少 )');
      return node;
    }
    if (t.kind === 'ident') {
      this.next();
      const nxt = this.peek();
      if (nxt && nxt.kind === 'lparen') {
        // 函数调用
        this.next(); // consume (
        const args: Node[] = [];
        const after = this.peek();
        if (after && after.kind === 'rparen') {
          this.next(); // 空参数列表
        } else {
          args.push(this.parseExpr());
          let sep = this.peek();
          while (sep && sep.kind === 'comma') {
            this.next();
            args.push(this.parseExpr());
            sep = this.peek();
          }
          const close = this.next();
          if (!close || close.kind !== 'rparen') throw new Error('括号不匹配：函数参数缺少 )');
        }
        return { type: 'call', name: t.value, args };
      }
      return { type: 'var', name: t.value };
    }
    if (t.kind === 'rparen') throw new Error('意外的 )');
    if (t.kind === 'comma') throw new Error('意外的 ,');
    throw new Error('意外的 token');
  }
}

function evalNode(node: Node, vars: Record<string, number>): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'var': {
      const v = vars[node.name];
      if (v === undefined || v === null) throw new Error(`未知变量: ${node.name}`);
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`变量值非法: ${node.name}`);
      return v;
    }
    case 'neg':
      return -evalNode(node.operand, vars);
    case 'bin': {
      const l = evalNode(node.left, vars);
      const r = evalNode(node.right, vars);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) throw new Error('除以零');
          return l / r;
      }
      // 不可达
      throw new Error('未知运算符');
    }
    case 'call':
      return evalCall(node, vars);
  }
}

function evalCall(node: Extract<Node, { type: 'call' }>, vars: Record<string, number>): number {
  const { name, args } = node;
  if (SINGLE_ARG_FNS.has(name)) {
    if (args.length !== 1) throw new Error(`函数 ${name} 需要 1 个参数，实际 ${args.length} 个`);
    const x = evalNode(args[0], vars);
    switch (name) {
      case 'ceil': return Math.ceil(x);
      case 'floor': return Math.floor(x);
      case 'round': return Math.round(x);
      case 'abs': return Math.abs(x);
    }
  }
  if (VARARG_FNS.has(name)) {
    if (args.length < 1) throw new Error(`函数 ${name} 至少需要 1 个参数`);
    const vals = args.map((a) => evalNode(a, vars));
    return name === 'min' ? Math.min(...vals) : Math.max(...vals);
  }
  throw new Error(`未知函数: ${name}`);
}

/**
 * 安全求值算术表达式。
 * @param expr 表达式字符串
 * @param vars 变量表（变量名 → 数值）
 * @returns 求值结果（有限数）
 * @throws 表达式为空/非法、变量未定义、除以零、结果非有限数等情况均抛 Error
 */
export function evaluateFormula(expr: string, vars: Record<string, number>): number {
  if (expr == null || expr.trim() === '') throw new Error('空表达式');
  if (expr.length > 1000) throw new Error('公式过长');
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new Error('空表达式');
  const ast = new Parser(tokens).parse();
  const result = evalNode(ast, vars);
  if (typeof result !== 'number' || Number.isNaN(result) || !Number.isFinite(result)) {
    throw new Error(`求值结果非有限数: ${result}`);
  }
  return result;
}
