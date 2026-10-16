import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// REQ-PB-105: every board colour comes from a --pb-* custom property, with
// built-in light and dark defaults that a host may override. This spec reads
// the stylesheet as text so it can police the source, not a rendered DOM.
const cssPath = resolve(process.cwd(), 'src/react/BoardView.css');
const css = readFileSync(cssPath, 'utf8');

// Remove the token declarations (`--pb-name: <value>;`). Whatever colour
// syntax is left afterwards is a hard-coded colour that slipped through.
const withoutTokenDefs = css.replace(/--pb-[a-z0-9-]+\s*:[^;]*;/gi, '');

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(/g;

const definedTokens = new Set(
  [...css.matchAll(/(--pb-[a-z0-9-]+)\s*:/gi)].map((match) => match[1]),
);
const usedTokens = [...css.matchAll(/var\((--pb-[a-z0-9-]+)/gi)].map((match) => match[1]);

describe('BoardView colour tokens (REQ-PB-105)', () => {
  it('defines --pb-* tokens on the board root (.board-view)', () => {
    expect(css).toMatch(/\.board-view\s*\{[\s\S]*--pb-bg\s*:/);
    // The ported label colour must survive the tokenisation.
    expect(css).toContain('--pb-label-bg: #eef1f0;');
  });

  it('keeps no hard-coded colour outside the token definitions', () => {
    expect(withoutTokenDefs.match(COLOUR) ?? []).toEqual([]);
  });

  it('only references --pb-* tokens that are defined', () => {
    const missing = [...new Set(usedTokens)].filter((name) => !definedTokens.has(name));
    expect(missing).toEqual([]);
  });

  it('ships a dark theme via prefers-color-scheme and data-pb-theme', () => {
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(css).toMatch(/\[data-pb-theme="light"\]\s+\.board-view/);
    expect(css).toMatch(/\[data-pb-theme="dark"\]\s+\.board-view/);
  });
});
