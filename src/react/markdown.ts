/**
 * Shared markdown → HTML pipeline for board card descriptions.
 *
 * PowerBoard's built-in default for `BoardViewProps.renderMarkdown`: GFM on,
 * task-list checkboxes left clickable, and no math (KaTeX stays a host
 * concern — PowerScroll passes its own `markdownToHtml` when embedded).
 */

import { marked } from 'marked';
import { normalizeListIndents } from './listIndent';

/**
 * Render board markdown to HTML: under-indented list children padded so Tab's
 * 2-space habit still nests, GFM on, and task-list checkboxes left clickable.
 */
export function defaultRenderMarkdown(text: string): string {
  if (!text) return '';
  const withNestedLists = normalizeListIndents(text);
  const html = marked.parse(withNestedLists, { breaks: true, gfm: true }) as string;
  // Remove disabled attribute from task-list checkboxes so clicks work
  return html
    .replace(/<input\s+disabled=""\s+type="checkbox"/g, '<input type="checkbox"')
    .replace(/<input\s+checked=""\s+disabled=""\s+type="checkbox"/g, '<input checked="" type="checkbox"');
}
