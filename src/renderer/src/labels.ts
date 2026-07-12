import type { QuoteMode } from '../../shared/api-types';

export const MODE_LABELS: Record<QuoteMode, string> = {
  estimate: '概算',
  budget: '方案预算',
  pricing: '造价清单',
  tender: '投标造价清单'
};
