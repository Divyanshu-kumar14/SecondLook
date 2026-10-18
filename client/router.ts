/**
 * Deterministic utterance router (Phase 4, task P4-2).
 *
 * SIMULATED NLU. In a real Alexa+ add-on the assistant picks the tool from the
 * customer's phrasing; here a fixed table does it, and the UI labels it as such
 * rather than pretending to be speech recognition.
 *
 * Typed input ALWAYS works. The router never blocks input it does not recognise
 * — it only offers a suggestion, and an unmatched utterance falls through to a
 * sensible default rather than an error.
 */
import type { Persona } from './mcp.js';

export type { Persona };

export interface Utterance {
  text: string;
  /** The tool the router believes applies. */
  tool: ToolName;
  args: Record<string, unknown>;
  /** Which pattern matched, for transparency in the UI. */
  matched: string | null;
}

export type ToolName =
  | 'find_problems'
  | 'check_dose'
  | 'record_dose'
  | 'request_regimen_change'
  | 'get_current_regimen'
  | 'explain_problem'
  | 'get_timeline'
  | 'get_handoff';

export const PERSON_ID = 'person-robert';

interface Rule {
  id: string;
  patterns: RegExp[];
  /**
   * `match` is the matched fragment; `utterance` is the WHOLE line. Slot
   * extraction must read the whole line — "I gave Dad 250 mg of Tylenol"
   * matches only on "I gave", so reading `match` alone loses the amount.
   */
  build: (
    match: RegExpMatchArray,
    persona: Persona,
    utterance: string,
  ) => { tool: ToolName; args: Record<string, unknown> };
}

/** Pull a medication name out of free text, defaulting to ibuprofen. */
function medicationFrom(text: string): string {
  const known: Record<string, string> = {
    ibuprofen: 'med-ibuprofen',
    tylenol: 'med-acetaminophen',
    paracetamol: 'med-acetaminophen',
    acetaminophen: 'med-acetaminophen',
    'paracetamol-based': 'med-acetaminophen',
  };
  const lower = text.toLowerCase();
  for (const [word, id] of Object.entries(known)) {
    if (lower.includes(word)) return id;
  }
  return 'med-ibuprofen';
}

/** Pull a milligram amount out of free text, defaulting to 500. */
function amountFrom(text: string): number {
  const match = /(\d{2,5})\s*(mg|milligram)/i.exec(text);
  return match ? Number(match[1]) : 500;
}

const RULES: Rule[] = [
  {
    id: 'are-we-doing-this-right',
    patterns: [
      /are we (doing this )?right/i,
      /anything wrong/i,
      /what problems?/i,
      /check (on )?(him|dad|robert|the care)/i,
      /is everything ok/i,
    ],
    build: () => ({ tool: 'find_problems', args: { personId: PERSON_ID } }),
  },
  {
    id: 'can-we-give',
    patterns: [
      /can (tom|we|i) give/i,
      /is it safe to give/i,
      /can he (have|take)/i,
      /should (i|we) give/i,
      /check .*before/i,
    ],
    build: (_m, _p, line) => ({
      tool: 'check_dose',
      args: { medicationId: medicationFrom(line), amount: amountFrom(line) },
    }),
  },
  {
    id: 'i-gave',
    patterns: [
      /\bi gave\b/i,
      /\bhe (had|took)\b/i,
      /\bwe gave\b/i,
      /record (a|the) dose/i,
      /\bgave (him|the)\b/i,
    ],
    build: (_m, persona, line) => ({
      tool: 'record_dose',
      args: {
        medicationId: medicationFrom(line),
        amount: amountFrom(line),
        note: `spoken by ${persona.name}`,
      },
    }),
  },
  {
    id: 'change-the-regimen',
    patterns: [
      /\bdouble\b/i,
      /change (the|his|her) (regimen|medication|dose)/i,
      /give (it|him) every (\d+) hours/i,
      /instead of every/i,
      /more often/i,
    ],
    build: (_m, _p, line) => {
      const every = /every (\d+) hours/i.exec(line);
      return {
        tool: 'request_regimen_change',
        args: {
          medicationId: medicationFrom(line),
          ...(every ? { newFrequency: Number(every[1]) } : { newFrequency: 4 }),
          reason: 'asked in conversation',
        },
      };
    },
  },
  {
    id: 'what-is-he-on',
    patterns: [
      /what is (he|dad|robert|he')? ?(on|taking)/i,
      /which (medicines|pills)/i,
      /what medication/i,
      /current regimen/i,
      /what.*on the list/i,
    ],
    build: () => ({ tool: 'get_current_regimen', args: { personId: PERSON_ID } }),
  },
  {
    id: 'why',
    patterns: [/^why\b/i, /show me why/i, /how did you (work|know)/i, /what evidence/i, /explain/i],
    build: () => ({ tool: 'find_problems', args: { personId: PERSON_ID } }),
  },
  {
    id: 'who-did-what',
    patterns: [
      /who gave/i,
      /what happened/i,
      /show me the refusals/i,
      /audit/i,
      /what did .* (do|record)/i,
    ],
    build: () => ({ tool: 'get_timeline', args: { personId: PERSON_ID, type: 'authority.*' } }),
  },
  {
    id: 'hand-off',
    patterns: [/hand (it )?off/i, /handover|hand over/i, /summarise (it )?for/i, /what does .* need to know/i],
    build: (_m, persona) => ({
      tool: 'get_handoff',
      args: { personId: PERSON_ID, toCaregiverId: `caregiver-${persona.id}` },
    }),
  },
];

/**
 * Route an utterance to a tool. Pure and deterministic: the same words always
 * produce the same call, which keeps the demo repeatable.
 */
export function route(text: string, persona: Persona): Utterance {
  const trimmed = text.trim();
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(trimmed);
      if (!match) continue;
      const built = rule.build(match, persona, trimmed);
      return { text: trimmed, ...built, matched: rule.id };
    }
  }
  // Nothing matched. Fall through to the headline check rather than failing —
  // an assistant would ask a clarifying question, and this cannot.
  return {
    text: trimmed,
    tool: 'find_problems',
    args: { personId: PERSON_ID },
    matched: null,
  };
}

/** Every example phrase the UI offers, for discoverability. */
export const EXAMPLES: readonly { label: string; text: string }[] = [
  { label: 'Second look', text: 'Are we doing this right?' },
  { label: 'Can Tom give it?', text: 'Can Tom give Dad his ibuprofen?' },
  { label: 'Record a dose', text: 'I gave Dad 500 mg of Tylenol' },
  { label: 'Ask to change', text: "Double Robert's acetaminophen" },
  { label: 'What is he on?', text: 'What is Dad on?' },
  { label: 'Audit log', text: 'Show me the refusals' },
];