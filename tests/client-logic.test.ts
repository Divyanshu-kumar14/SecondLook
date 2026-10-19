import { describe, expect, it } from 'vitest';
import { route, EXAMPLES, type Persona } from '../client/router.js';
import {
  capWords,
  listWords,
  MAX_SPOKEN_WORDS,
  speakFinding,
  speakNoFindings,
  speakRecorded,
  speakRefusal,
  speakVerdict,
  wordCount,
  type Finding,
} from '../client/phrase.js';

const priya: Persona = { id: 'priya', name: 'Priya', role: 'full', token: 'demo-priya', blurb: '' };
const tom: Persona = { id: 'tom', name: 'Tom', role: 'record', token: 'demo-tom', blurb: '' };

describe('P4-2 · utterance router', () => {
  it('routes the three demo-spine utterances correctly', () => {
    expect(route('Are we doing this right?', priya).tool).toBe('find_problems');
    expect(route('Can Tom give Dad his ibuprofen?', tom).tool).toBe('check_dose');
    expect(route("Double Robert's acetaminophen", tom).tool).toBe('request_regimen_change');
  });

  it('routes the remaining five tools', () => {
    expect(route('I gave Dad his Tylenol', priya).tool).toBe('record_dose');
    expect(route('What is Dad on?', priya).tool).toBe('get_current_regimen');
    expect(route('Why?', priya).tool).toBe('find_problems');
    expect(route('Show me the refusals', priya).tool).toBe('get_timeline');
    expect(route('Hand off to Priya', priya).tool).toBe('get_handoff');
  });

  it('extracts the medication from free text', () => {
    expect(route('Can Tom give Dad his ibuprofen?', tom).args.medicationId).toBe('med-ibuprofen');
    expect(route('Can we give the Tylenol?', tom).args.medicationId).toBe('med-acetaminophen');
    expect(route('is it safe to give paracetamol', tom).args.medicationId).toBe('med-acetaminophen');
  });

  it('extracts a milligram amount and defaults sensibly', () => {
    expect(route('I gave Dad 250 mg of Tylenol', priya).args.amount).toBe(250);
    expect(route('I gave Dad his Tylenol', priya).args.amount).toBe(500);
  });

  it('extracts a frequency for a regimen change', () => {
    expect(route('give him every 3 hours instead', priya).args).toMatchObject({ newFrequency: 3 });
    expect(route("Double Robert's acetaminophen", priya).args).toMatchObject({ newFrequency: 4 });
  });

  it('falls through rather than failing, and says so', () => {
    const r = route('the weather is nice today', priya);
    expect(r.matched).toBeNull();
    // The CLIENT decides not to call a tool when nothing matched; the router
    // still returns a usable shape rather than throwing.
    expect(r.tool).toBe('find_problems');
  });

  it('still routes a real question after an unmatched one', () => {
    route('hello', priya);
    expect(route('Are we doing this right?', priya).matched).toBe('are-we-doing-this-right');
  });

  it('is deterministic — the same words always produce the same call', () => {
    for (const { text } of EXAMPLES) {
      expect(JSON.stringify(route(text, priya))).toBe(JSON.stringify(route(text, priya)));
    }
  });

  it('always routes to one of the nine tools with an object argument', () => {
    for (const { text } of EXAMPLES) {
      const r = route(text, priya);
      expect(typeof r.tool).toBe('string');
      expect(typeof r.args).toBe('object');
    }
  });

  it('passes the persona through where it matters', () => {
    expect(route('I gave Dad his Tylenol', tom).args.note).toContain('Tom');
    expect(route('Hand off to Priya', tom).args.toCaregiverId).toBe('caregiver-tom');
  });
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  findingId: 'f-test',
  rules: ['R3', 'R4'],
  severity: 'critical',
  what: 'ibuprofen was given on 2026-10-15, after it was stopped on 2026-10-13',
  evidence: ['e1', 'e2'],
  when: '2026-10-15T20:00:00.000Z',
  nextAction: 'STOP_GIVING',
  ...over,
});

describe('spoken lists read as English, not as joins', () => {
  it('joins two with "and"', () => {
    expect(listWords(['R1', 'R2'])).toBe('R1 and R2');
  });

  it('joins three with a comma then "and" — never "and and and"', () => {
    expect(listWords(['R3', 'R4', 'R6'])).toBe('R3, R4 and R6');
  });

  it('handles one and none', () => {
    expect(listWords(['R5'])).toBe('R5');
    expect(listWords([])).toBe('');
  });

  it('reaches the spoken finding sentence', () => {
    const spoken = speakFinding(finding()); // rules R3, R4
    expect(spoken).toMatch(/R3 and R4/);
    const many = speakFinding(finding({ rules: ['R1', 'R2', 'R3'] }));
    expect(many).toMatch(/R1, R2 and R3/);
    expect(many).not.toMatch(/and R1 and/);
  });
});

describe('P4-3 · phrasing layer', () => {
  it('counts and caps words', () => {
    expect(wordCount('  one   two  ')).toBe(2);
    expect(capWords('a b c d', 3)).toBe('a b c…');
    expect(wordCount(capWords('a b c d', 3))).toBeLessThanOrEqual(3);
  });

  it('keeps every spoken finding within 25 words', () => {
    const cases: Finding[] = [
      finding(),
      finding({ severity: 'high', nextAction: 'CHECK_LABEL_WITH_PHARMACY', rules: ['R1', 'R2'] }),
      finding({ severity: 'medium', nextAction: 'ASK_AUTHORIZED_CAREGIVER', rules: ['R6'] }),
      finding({
        severity: 'critical',
        rules: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
        nextAction: 'CONTACT_PRESCRIBER',
        acknowledged: true,
      }),
    ];
    for (const f of cases) {
      const spoken = speakFinding(f);
      expect(wordCount(spoken), `"${spoken}"`).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
    }
  });

  it('names the medication, the rules and the action', () => {
    const spoken = speakFinding(finding());
    expect(spoken).toMatch(/Ibuprofen/);
    expect(spoken).toMatch(/R3 and R4/);
    expect(spoken).toMatch(/stop giving it/);
  });

  it('says an acknowledged finding is seen, not fixed', () => {
    // Assert the SPACE too, not just the substring. Matching /Seen, not fixed/
    // passed while the sentence read "...pharmacy.Seen, not fixed."
    expect(speakFinding(finding({ acknowledged: true }))).toMatch(/\. Seen, not fixed\.$/);
    expect(speakFinding(finding({ acknowledged: false }))).not.toMatch(/Seen/);
  });

  it('treats the actor as provenance, never as cause', () => {
    // The spoken form must never blame whoever recorded the evidence.
    for (const f of [finding(), finding({ rules: ['R6'], nextAction: 'ASK_AUTHORIZED_CAREGIVER' })]) {
      const spoken = speakFinding(f);
      expect(spoken).not.toMatch(/Elena|Tom|Priya|caused|because of|blame|fault/i);
    }
  });

  it('speaks each verdict distinctly', () => {
    expect(speakVerdict('DO_NOT_GIVE', [{ ruleId: 'R3' }])).toMatch(/Do not give it/);
    expect(speakVerdict('CAUTION', [{ ruleId: 'R1' }])).toMatch(/with care/);
    expect(speakVerdict('OK', [])).toMatch(/Nothing in the record objects/);
  });

  it('speaks a refusal without blame', () => {
    const spoken = speakRefusal('full-authority caregiver');
    expect(spoken).toMatch(/not yours to change/);
    expect(spoken).not.toMatch(/error|failed|denied!/i);
  });

  it('mentions flags on a recorded dose only when there are any', () => {
    expect(speakRecorded('Tom', [])).toBe('Tom recorded the dose.');
    expect(speakRecorded('Tom', [{ ruleId: 'R6' }])).toMatch(/raised R6/);
  });

  it('never lets an empty result sound like reassurance', () => {
    const clean = speakNoFindings(16, 0);
    expect(clean).toMatch(/not the same as safe/);
    const withGaps = speakNoFindings(16, 7);
    expect(withGaps).toMatch(/7 expected doses are not logged/);
    expect(wordCount(withGaps)).toBeLessThanOrEqual(MAX_SPOKEN_WORDS);
  });

  it('is deterministic', () => {
    expect(speakFinding(finding())).toBe(speakFinding(finding()));
    expect(speakVerdict('CAUTION', [{ ruleId: 'R1' }])).toBe(
      speakVerdict('CAUTION', [{ ruleId: 'R1' }]),
    );
  });
});