# DESIGN — Second Look

Design context for the demo client, written after the Tailwind + Motion rebuild. The direction is
recorded here so it does not have to be inferred from the stylesheet.

## Mode: **Operate**

This is a tool. Someone opens it mid-crisis, usually about a person they care for, usually
mid-shift. Scanability, consistency and the real usage scene matter more than expression. The
interface should not get in the way of a finding.

It is not a landing page: no hero, no marketing register, no motion that exists to impress.

## The one idea the design serves

> The system never asserts anything it cannot show you the record for.

Every design decision below follows from that line: colour, motion, wording, and the refusal to
present an empty result as an answer.

## Palette — calm clinical, high trust

Base is warm paper, not white. Pure white reads institutional; this is a household tool and the
surface should not imply a hospital.

| Token | Light | Role |
|---|---|---|
| `paper` | `#f7f4ee` | page |
| `card` | `#fffdf9` | raised surface |
| `ink` | `#191714` | text |
| `ink-soft` / `ink-faint` | `#55503f` / `#6f6a5c` | secondary, tertiary |
| `trust` | `#1c6136` | acknowledgment, safe actions |
| `critical` → `low` | 4 steps | severity only |

Colour is spent almost entirely on severity. Nothing else is tinted, so a critical finding is
visible in peripheral vision without shouting.

Dark mode re-tints every severity instead of inverting the palette, because an inverted red on
black loses the contrast that made it legible. Each pairing clears 4.5:1 as text on its own tint
in both schemes.

## Severity is never a border

A coloured left edge on a card is the most recognisable tell of a generated interface, and the
design detector flagged it on the first pass. Severity is carried by three redundant signals
instead:

1. a tinted surface (`sev-critical` → `critical-tint`)
2. a named label: "Critical", not "!!"
3. a dot in the same hue

The phrasing layer also speaks the severity word. A screen reader and a person in a loud room
both get it.

## Motion — one authored moment

Motion points at arrivals and does nothing else.

- A new turn arrives: springs from below with a slight blur, settles fast, never bounces.
  Exponential ease-out.
- Findings resolve one after another in severity order, so the eye follows rank.
- The evidence drawer expands on height, so nothing jumps.
- Persona changes crossfade, because a hard swap flickers.

Nothing else moves. Findings do not pulse, critical items do not glow, and there is no ambient
background motion. A tool used mid-crisis cannot have decoration competing with a finding for
attention.

### Reduced motion is honoured twice

Either layer can be bypassed, so both are needed:

1. `MotionConfig reducedMotion="user"` drops transform and layout animation.
2. A CSS `@media (prefers-reduced-motion: reduce)` block kills everything else, including
   anything written without Motion.

Reduced motion is Tier-0 (P4-10) and non-negotiable.

## Voice

- Actor is provenance, never cause. The interface says *"recorded by Tom, from a caregiver"*,
  never *"caused by Tom"*. Wording lives in one function (`provenanceLine`) so it cannot drift.
- Never say "all clear". `assurance` is `NONE_FOUND_IN_RECORD` or `FINDINGS_PRESENT`, and every
  answer ships coverage beside it.
- An empty result states what was empty. The evidence drawer has three states: loading, loaded
  and failed, because a confident "0 records" hides which of the three is true.
- A refusal is a result, not an error. No red styling, no failure chrome.
- Ask when unclear. An unrecognised utterance says so rather than silently answering a different
  question.

## Structure

Conversation on the left, the record on the right. The record is one column with three views
(Problems, Audit log, Handover), switched rather than stacked, because stacking all three pushes
findings below the fold on a laptop.

Below `lg`, everything stacks and the transcript becomes `60vh` rather than a fixed `24rem`,
which would otherwise eat a phone screen.

## Surfaces nobody draws

Text selection, focus rings, scrollbars and underline offsets are themed from the palette, because
browser defaults belong to no design system and are the cheapest signal of an assembled page.
Tabular figures go on every number compared down a column (latency, timestamps, sequence numbers).

## Stack

Tailwind v4 (CSS-first, tokens in `@theme`) and Motion. The bundle cost is real: the client ships
the MCP SDK to the browser, so the JS is ~676 kB (~206 kB gzipped). That is a known, accepted
trade; calling the protocol properly is worth more than a smaller bundle for this submission.

## Banned here

- Gradient text
- Glass and blur as decoration
- Coloured `border-left` above 1px
- Hard offset shadows
- Unicode glyphs standing in for icons
- Monospace as a "technical" costume (monospace is used only for ids, codes and measurements)
- Kicker/eyebrow labels above headings
- Section numbers
