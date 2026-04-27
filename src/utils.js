/**
 * Utility functions
 */

/**
 * Strip thinking protocol blocks from text
 * Removes both <thinking_protocol>...</thinking_protocol> tags
 * and markdown-style thinking blocks
 */
export function stripThinkingBlocks(text) {
  if (!text) return text;

  let cleaned = text;

  // Remove <thinking_protocol>...</thinking_protocol> blocks
  cleaned = cleaned.replace(/<thinking_protocol>[\s\S]*?<\/thinking_protocol>/gi, '');

  // Remove markdown thinking blocks (```thinking ... ```)
  cleaned = cleaned.replace(/```thinking[\s\S]*?```/gi, '');

  // Clean up excessive whitespace left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

/**
 * Format markdown for better display
 * Converts markdown to more readable format
 */
export function formatMarkdown(text) {
  if (!text) return text;

  // First strip thinking blocks
  let formatted = stripThinkingBlocks(text);

  // Convert markdown headers to HTML-friendly format
  formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  formatted = formatted.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  formatted = formatted.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Convert bold
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert bullet points
  formatted = formatted.replace(/^- (.*$)/gim, '• $1');

  return formatted;
}

export function resolveMarketPrice(quote, options = {}) {
  const {
    marketOpen = true,
    fallback = 0
  } = options;

  if (!quote || typeof quote !== 'object') {
    return fallback;
  }

  const candidates = [quote.price, quote.last, quote.previousClose, quote.close];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return fallback;
}
