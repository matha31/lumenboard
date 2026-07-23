// backend/mcp-server/src/sanitize.mjs — neutralize free-text fields the API returns
// (account names, event metadata) before they reach the model or the rendered
// artifact. Proposal §03: "returned content is treated as data, not
// instructions — the tool layer doesn't let it redirect what the model does
// next."
//
// This is defense-in-depth, not a complete prompt-injection solution: it strips
// the mechanical carriers of a hidden payload — control, zero-width, and bidi
// characters, plus hard line breaks that could fake a new turn/instruction —
// collapses whitespace, and caps length so one field can't smuggle a wall of
// text. Legitimate names ("Nimbus Studio") pass through unchanged. Dependency-
// free because the browser artifact imports this chain over http.

const DEFAULT_MAX = 200;

// Code-point ranges to strip, kept numeric so no literal control characters
// live in this source file:
//   0x00-0x1F, 0x7F-0x9F  C0/C1 controls + DEL
//   0x200B-0x200F         zero-width space/joiners, LRM/RLM
//   0x202A-0x202E         bidi embeddings/overrides
//   0x2066-0x2069         bidi isolates
//   0xFEFF                BOM / zero-width no-break space
const STRIP_RANGES = [
  [0x00, 0x1f], [0x7f, 0x9f],
  [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff],
];

function isStripped(cp) {
  for (const [lo, hi] of STRIP_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

export function sanitizeApiText(value, maxLen = DEFAULT_MAX) {
  if (value === null || value === undefined) return value;
  const str = typeof value === 'string' ? value : String(value);
  let out = '';
  for (const ch of str) out += isStripped(ch.codePointAt(0)) ? ' ' : ch;
  const cleaned = out.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 1) + '…' : cleaned;
}
