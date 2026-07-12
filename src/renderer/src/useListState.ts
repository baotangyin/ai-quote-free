import { useState } from 'react';

/**
 * localStorage 持久化状态；key 建议 'aiquote.filters.<page>'。
 * - 初始值优先读 localStorage（JSON.parse 容错，失败/无值回退 initial）。
 * - setter 同步写 localStorage（try/catch，写失败静默）。
 * - SSR/无 window 环境安全（typeof window 检查）。
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const readInitial = (): T => {
    if (typeof window === 'undefined' || !window.localStorage) return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  };

  const [value, setValue] = useState<T>(readInitial);

  const setPersisted = (v: T): void => {
    setValue(v);
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // 写入失败（如隐私模式/配额）静默，不影响内存状态
    }
  };

  return [value, setPersisted];
}

/**
 * 去重保序合并两个分类数组：保留 cur 的顺序，追加 add 中尚未出现的项。
 * 供「加标签（追加）」预览与批量操作复用，同时便于纯函数单测。
 */
export function mergeCategories(cur: string[], add: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const c of [...(cur ?? []), ...(add ?? [])]) {
    if (c == null) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    result.push(c);
  }
  return result;
}
