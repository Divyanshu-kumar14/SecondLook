/**
 * Phrasing layer (Phase 4, task P4-3).
 *
 * SIMULATED ALEXA PHRASING. Alexa+ generates its own speech; this maps a typed
 * record to a deterministic sentence so the demo has something speakable. The UI
 * labels it as simulated — claiming otherwise would be the dishonest part.
 *
 * Two hard constraints:
 *   • A spoken finding is at most 25 WORDS.
 *   • Actor is PROVENANCE, never cause. The phrasing never says someone caused
 *     a problem; it says who recorded the evidence.
 */

export const MAX_SPOKEN_WORDS = 25;

export interface Finding {
  findingId: string;
  rules: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  what: string;
  evidence: string[];
  when: string;
  nextAction: string;
  acknowledged?: boolean;
}

const SEVERITY_WORDS: Record<Finding['severity'], string> = {
  critical: 'Stop',
  high: 'Watch',
  medium: 'Note',
  low: 'Note',
};

const ACTION_PHRASES: Record<string, string> = {
  STOP_GIVING: 'stop giving it',
  CONTACT_PRESCRIBER: 'call the prescriber',
  ASK_AUTHORIZED_CAREGIVER: 'ask an authorised carer',
  CHECK_LABEL_WITH_PHARMACY: 'check the label with the pharmacy',
  RECORD_MISSING_DOSE: 'record the missing dose',
  ACKNOWLEDGE: 'acknowledge it',
};

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Trim to the word budget on a clause boundary where possible. */
export function capWords(text: string, max = MAX_SPOKEN_WORDS): string {
  if (wordCount(text) <= max) return text;
  const words = text.trim().split(/\s+/);
  const kept = words.slice(0, max);
  // Prefer ending on a clause boundary.
  for (let i = kept.length - 1; i > 0; i -= 1) {
    if (/[,;:]$/.test(kept[i]!)) {
      kept.length = i + 1;
      break;
    }
  }
  return `${kept.join(' ').replace(/[,;:]$/, '')}…`;
}

/**
 * One sentence for a finding, within the word budget.
 *
 * Derived from ruleId + nextAction rather than from the server's `what`, because
 * a spoken sentence should be short and directive while `what` is written to be
 * read on screen with its evidence.
 */
export function speakFinding(finding: Finding): string {
  const verb = SEVERITY_WORDS[finding.severity];
  const action = ACTION_PHRASES[finding.nextAction] ?? 'review it';
  const med = medicationWord(finding.what);
  const ack = finding.acknowledged ? ' Seen, not fixed.' : '';

  // The leading space on `ack` is load-bearing. A `.trim()` used to sit on this
  // concatenation and stripped it, producing "...with the pharmacy.Seen, not
  // fixed." in the spoken answer — visible on screen and audible in the demo
  // video. The existing test matched a bare substring and never noticed.
  const sentence = `${verb}. ${med} ${listWords(finding.rules)} — ${action}.${ack}`;

  return capWords(sentence);
}

/**
 * Render a list the way a person says it: "R3, R4 and R6", never
 * "R3 and R4 and R6". These strings get spoken aloud in the demo video, so
 * joining with "and" is a visible defect, not a style preference.
 */
export function listWords(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** Pull the medication out of the server's sentence, for the spoken form. */
function medicationWord(what: string): string {
  const known: [RegExp, string][] = [
    [/ibuprofen/i, 'Ibuprofen'],
    [/acetaminophen|paracetamol|tylenol/i, 'Paracetamol'],
  ];
  for (const [pattern, word] of known) {
    if (pattern.test(what)) return word;
  }
  return 'That medication';
}

/** Spoken form of a `check_dose` verdict. */
export function speakVerdict(verdict: string, reasons: { ruleId: string }[]): string {
  const rules = listWords([...new Set(reasons.map((r) => r.ruleId))]);
  switch (verdict) {
    case 'DO_NOT_GIVE':
      return capWords(`Do not give it. ${rules} fired.`);
    case 'CAUTION':
      return capWords(`Give it with care. ${rules} fired.`);
    default:
      return 'Nothing in the record objects to that.';
  }
}

/** Spoken form of a refusal. The reason is never blame. */
export function speakRefusal(whoCan: string): string {
  return capWords(`That is not yours to change. Only ${whoCan} can.`);
}

/** Spoken form of a recorded dose. */
export function speakRecorded(name: string, flags: { ruleId: string }[]): string {
  const rules = [...new Set(flags.map((f) => f.ruleId))];
  if (rules.length === 0) return capWords(`${name} recorded the dose.`);
  return capWords(`${name} recorded the dose. It raised ${listWords(rules)}.`);
}

/** Spoken form of a clean scan — must never sound like reassurance. */
export function speakNoFindings(scanned: number, unlogged: number): string {
  if (unlogged > 0) {
    return capWords(
      `Nothing found in the ${scanned} records read, but ${unlogged} expected doses are not logged.`,
    );
  }
  return capWords(`Nothing found in the ${scanned} records read. That is not the same as safe.`);
}