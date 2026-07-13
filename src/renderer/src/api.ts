import type { AiQuoteApi } from '../../shared/api-types';

/**
 * Typed wrapper for window.api (Electron IPC API)
 */
export const api = (window as any).api as AiQuoteApi;
