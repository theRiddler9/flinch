/**
 * Parsing for assistant replies: separates the manual modeling guide from the executable Python
 * block so each can be shown on its own. Display-only; the Rust agent (`extract_python_code`)
 * decides which code actually runs.
 */

export interface GuideStep {
  number: number;
  title: string;
  body: string[];
}

export interface ModelingGuide {
  intro: string[];
  steps: GuideStep[];
  tipsTitle: string | null;
  tips: string[];
  /** The reply only says the guide is unchanged from the previous attempt. */
  unchanged: boolean;
}

export type ReplySegment =
  | { kind: 'text'; text: string }
  | { kind: 'guide'; guide: ModelingGuide }
  | { kind: 'code'; lang: string; code: string; closed: boolean };

const GUIDE_HEADING = /^\s*#{1,6}\s*.*manual blender step-by-step modeling guide/i;
const SCRIPT_HEADING = /^\s*#{1,6}\s*.*executable blender python/i;
const STEP_START = /^\s{0,3}(\d{1,2})[.)]\s+(.*)$/;
const BULLET = /^\s*[-*\u2022]\s+(.*)$/;
const TIPS_LINE = /^(tips|tips\s+for\b[^:]*|customi[sz]ation\b[^:]*|next steps)\s*:?\s*$/i;
const UNCHANGED = /^[_*\s]*guide unchanged\.?[_*\s]*$/i;
const FENCE_OPEN = /^(\s*)(`{3,})\s*([^`\s]*)[^`]*$/;
const PY_LANG = /^(python|py|python3|py3|bpy)$/i;

const isBoldOnlyLine = (line: string) => /^\s*\*\*[^*]+\*\*:?\s*$/.test(line);
const isHeadingLine = (line: string) => /^\s*#{1,6}\s+\S/.test(line);
const cleanTitle = (raw: string) => raw.replace(/[:.\u2014-]+\s*$/, '').replace(/^\*\*|\*\*$/g, '').trim();

/** Splits the first line of a step into a short title and the rest of the sentence. */
function splitStepHead(rest: string): { title: string; remainder: string } {
  const bold = /^\*\*(.+?)\*\*\s*[:.\u2014\u2013-]*\s*(.*)$/.exec(rest);
  if (bold) return { title: cleanTitle(bold[1]), remainder: bold[2].trim() };
  const colon = rest.indexOf(': ');
  if (colon > 0 && colon <= 60) return { title: cleanTitle(rest.slice(0, colon)), remainder: rest.slice(colon + 2).trim() };
  const sentence = /^(.{3,70}?[.!])\s+(.*)$/.exec(rest);
  if (sentence) return { title: cleanTitle(sentence[1]), remainder: sentence[2].trim() };
  return { title: cleanTitle(rest), remainder: '' };
}

/** Parses the lines under the guide heading into intro, numbered steps and tips. */
export function parseGuideLines(lines: string[]): ModelingGuide {
  const guide: ModelingGuide = { intro: [], steps: [], tipsTitle: null, tips: [], unchanged: false };
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length > 0 && nonEmpty.length <= 2 && nonEmpty.every((l) => UNCHANGED.test(l))) {
    guide.unchanged = true;
    return guide;
  }

  let current: GuideStep | null = null;
  let inTips = false;
  for (const line of lines) {
    if (!line.trim()) continue;

    const step = STEP_START.exec(line);
    if (step && !inTips) {
      const { title, remainder } = splitStepHead(step[2]);
      current = { number: Number(step[1]), title, body: remainder ? [remainder] : [] };
      guide.steps.push(current);
      continue;
    }

    // A heading, a bold-only line or a bare "Tips:" line after the steps starts the tips list.
    const startsTips =
      guide.steps.length > 0 &&
      !/^\s/.test(line) &&
      !BULLET.test(line) &&
      (isHeadingLine(line) || isBoldOnlyLine(line) || TIPS_LINE.test(line.trim()));
    if (startsTips) {
      inTips = true;
      current = null;
      guide.tipsTitle = cleanTitle(line.replace(/^\s*#{1,6}\s*/, ''));
      continue;
    }

    if (inTips) {
      const bullet = BULLET.exec(line);
      guide.tips.push((bullet ? bullet[1] : line).trim());
    } else if (current) {
      current.body.push(line.trim());
    } else if (!isHeadingLine(line)) {
      guide.intro.push(line.trim());
    }
  }
  return guide;
}

/** Splits an assistant reply into text, guide and code segments (safe on partial/streaming text). */
export function splitReply(content: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  const lines = content.split(/\r?\n/);
  let text: string[] = [];
  const flushText = () => {
    const joined = text.join('\n').trim();
    if (joined) segments.push({ kind: 'text', text: joined });
    text = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (GUIDE_HEADING.test(line)) {
      flushText();
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const fence = FENCE_OPEN.exec(lines[i]);
        if (SCRIPT_HEADING.test(lines[i]) || GUIDE_HEADING.test(lines[i]) || (fence && PY_LANG.test(fence[3]))) break;
        body.push(lines[i]);
      }
      segments.push({ kind: 'guide', guide: parseGuideLines(body) });
      continue;
    }

    if (SCRIPT_HEADING.test(line)) {
      flushText(); // the heading adds nothing next to the code block
      i++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      flushText();
      const code: string[] = [];
      let closed = false;
      for (i++; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^`{3,}$/.test(t) && t.length >= fence[2].length) {
          closed = true;
          i++;
          break;
        }
        code.push(lines[i]);
      }
      segments.push({ kind: 'code', lang: fence[3] || 'python', code: code.join('\n').replace(/\s+$/, ''), closed });
      continue;
    }

    text.push(line);
    i++;
  }
  flushText();
  return segments;
}

/** The newest guide in a raw reply that has real content, or null. */
export function extractGuide(raw: string): ModelingGuide | null {
  const guides = splitReply(raw).flatMap((s) => (s.kind === 'guide' ? [s.guide] : []));
  for (let k = guides.length - 1; k >= 0; k--) {
    if (!guides[k].unchanged && (guides[k].steps.length > 0 || guides[k].intro.length > 0)) return guides[k];
  }
  return null;
}

/** Guide for attempt `index`, falling back to earlier attempts when a reply says "unchanged". */
export function resolveGuide(rawResponses: string[], index: number): ModelingGuide | null {
  for (let k = Math.min(index, rawResponses.length - 1); k >= 0; k--) {
    const g = extractGuide(rawResponses[k]);
    if (g) return g;
  }
  return null;
}

// ── Inline formatting ─────────────────────────────────────────────────────────────

export type PathPart = { kind: 'keys'; keys: string[] } | { kind: 'label'; value: string };

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'keys'; keys: string[] }
  | { kind: 'path'; parts: PathPart[] }
  | { kind: 'code'; value: string };

const NAMED_KEY =
  /^(ctrl|control|cmd|command|shift|alt|option|tab|enter|return|esc|escape|space|del|delete|backspace|home|end|pageup|pagedown|up|down|left|right|lmb|rmb|mmb|wheel|scroll|f([1-9]|1[0-2])|numpad ?[0-9.+\-*/]|num ?[0-9.])$/i;

/** True for strings like `Shift + A`, `Tab`, `Ctrl + Shift + C`, `X`. */
export function isShortcut(value: string): boolean {
  const parts = value.split(/\s*\+\s*/).map((p) => p.trim());
  if (parts.some((p) => !p)) return false;
  return parts.every(
    (p) => NAMED_KEY.test(p) || /^[A-Za-z0-9]$/.test(p) || /^[`~!@#$%^&*()_=[\]{};':",.<>/?\\|-]$/.test(p),
  );
}

const splitKeys = (value: string) => value.split(/\s*\+\s*/).map((p) => p.trim());

/** Turns text with `code`, **bold**, shortcuts and `A > B` menu paths into tokens. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  for (const piece of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
    if (!piece) continue;
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      const value = piece.slice(1, -1).trim();
      if (value.includes(' > ')) {
        const parts: PathPart[] = value
          .split(/\s+>\s+/)
          .map((seg) => (isShortcut(seg) ? { kind: 'keys', keys: splitKeys(seg) } : { kind: 'label', value: seg }));
        tokens.push({ kind: 'path', parts });
      } else if (isShortcut(value)) {
        tokens.push({ kind: 'keys', keys: splitKeys(value) });
      } else {
        tokens.push({ kind: 'code', value });
      }
    } else if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      tokens.push({ kind: 'bold', value: piece.slice(2, -2) });
    } else {
      tokens.push({ kind: 'text', value: piece });
    }
  }
  return tokens;
}
