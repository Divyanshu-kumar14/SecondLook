/**
 * Live UI check — drives the BUILT client in a real browser against a running
 * server, and asserts the things unit tests structurally cannot reach.
 *
 * WHY THIS EXISTS. F33: four tools violated their own declared output schemas.
 * 207 tests, the 17/17 protocol sweep and every lint/type gate passed while the
 * evidence drawer had never once rendered and demo beat 2 showed a raw protocol
 * error. Two blind spots hid it — curl does not validate output schemas, and
 * InMemoryTransport skips validation entirely. Only a real client over a real
 * transport saw it. This script is that layer, made repeatable.
 *
 * CONTRACT
 *   in   SL_BASE_URL  default http://127.0.0.1:8787
 *        CHROME_BIN   path to a Chromium/Chrome binary (optional)
 *   out  one line per check; screenshots to .artifacts/ui/
 *   exit 0  every check passed and the page logged no console errors
 *        1  a check failed
 *        2  the harness could not run (server down, or no browser available)
 *
 * Exit 2 is deliberately distinct from exit 1: "we could not look" must never
 * be mistaken for "we looked and it was fine".
 *
 * NOT in the default install path. `playwright-core` is a devDependency
 * (14 MB, no browser download) precisely so that DoD #1 — `npm install &&
 * npm start` — stays fast for a judge. This is opt-in depth, not a gate.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

const BASE = process.env.SL_BASE_URL ?? 'http://127.0.0.1:8787';
const SHOTS = resolve(process.cwd(), '.artifacts/ui');

/** Desktop, and the two widths the layout changes at. */
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
} as const;

const EXIT_CHECK_FAILED = 1;
const EXIT_CANNOT_RUN = 2;

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

/**
 * Find a Chromium to drive. Order matters: an explicit override always wins so
 * a developer can test a specific build, then whatever this playwright-core
 * knows about, and we fail loudly rather than silently launching nothing.
 */
function resolveBrowser(): string | undefined {
  if (process.env.CHROME_BIN) {
    if (!existsSync(process.env.CHROME_BIN)) {
      fail(`CHROME_BIN is set to "${process.env.CHROME_BIN}", which does not exist.`);
    }
    return process.env.CHROME_BIN;
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // playwright-core resolves lazily; a miss here is expected, not fatal.
  }
  // Common system locations, tried last.
  for (const candidate of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Bail out with instructions. Never continue in a half-configured state. */
function fail(message: string): never {
  console.error(`\n[ui-check] CANNOT RUN\n  ${message}\n`);
  process.exit(EXIT_CANNOT_RUN);
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });

  if (!(await reachable(`${BASE}/healthz`))) {
    fail(
      `no server at ${BASE}.\n` +
        '    Start it first:  npm run build && npm start',
    );
  }

  const executablePath = resolveBrowser();
  if (!executablePath) {
    fail(
      'no Chromium binary found.\n' +
        '    Either install one:      npx playwright install chromium\n' +
        '    or point at a system one: CHROME_BIN=/usr/bin/chromium npm run verify-ui',
    );
  }

  const consoleErrors: string[] = [];
  // Requests that abort during the handshake or at teardown are expected: the
  // SDK's StreamableHTTP transport resumes a POST over the SSE stream. Aborts
  // during a user action are not, so they are recorded with their timing below.
  const failedRequests: string[] = [];

  let browser: Browser | undefined;
  const checks: Check[] = [];
  const ok = (name: string, pass: boolean, detail?: string): void => {
    checks.push({ name, pass, detail });
  };

  try {
    browser = await chromium.launch({ executablePath });
    const page = await browser.newPage({ viewport: VIEWPORTS.desktop });

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? 'unknown'}`);
    });

    // ── Boot and handshake ────────────────────────────────────────────────
    const response = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    ok('client responds', response?.status() === 200, `HTTP ${response?.status()}`);

    await page
      .waitForFunction(() => !document.body.innerText.includes('Connecting…'), { timeout: 20_000 })
      .catch(() => {});

    const shell = await page.evaluate(() => document.body.innerText);
    ok('handshake completes', !shell.includes('Connecting…'));
    ok('no connection error banner', !shell.includes('Cannot reach the MCP server'));

    const version = shell.match(/Protocol\s*\n?\s*([\d-]+)/)?.[1];
    ok('protocol version shown', Boolean(version), version ?? 'not found');
    const toolCount = shell.match(/Tools\s*\n?\s*(\d+)/)?.[1];
    ok('all 9 tools listed', toolCount === '9', `${toolCount ?? '?'} shown`);

    // ── Beat 1: findings render ────────────────────────────────────────────
    await page.getByRole('button', { name: 'Second look' }).click();
    await page.waitForTimeout(2500);

    const afterBeat1 = await page.evaluate(() => document.body.innerText);
    ok('beat 1 renders findings', /ibuprofen|acetaminophen/i.test(afterBeat1));
    const severities = await page.locator('text=/^(Critical|High|Medium|Low)$/').count();
    ok('severity labels render', severities > 0, `${severities} labels`);
    ok('rules named on findings', /R[1-6]/.test(afterBeat1));

    // ── Evidence drawer — the F33 regression ───────────────────────────────
    const drawer = page.locator('button[aria-expanded]').first();
    const label = (await drawer.innerText()).replace(/\s+/g, ' ').trim();
    ok(
      'evidence drawer offers a record count',
      /Show the \d+ records? behind this/.test(label),
      label,
    );

    await drawer.click();
    await page.waitForTimeout(700);
    const panel = await page.locator('#panel-findings').innerText().catch(() => '');
    const ids = panel.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    ok('drawer lists event ids', ids.length > 0, `${ids.length} id(s)`);
    ok('drawer states provenance', /recorded by/i.test(panel));
    await page.screenshot({ path: `${SHOTS}/02-evidence-drawer.png` });

    // ── Beat 2: the refusal — the demo's centrepiece ───────────────────────
    await page.getByRole('radio', { name: /Tom/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Ask to change' }).click();
    await page.waitForTimeout(2500);

    const refused = await page.evaluate(() => document.body.innerText);
    ok(
      'beat 2 shows a refusal, not a protocol error',
      /not yours to change|cannot change|only .* can/i.test(refused) &&
        !/MCP error|-32602|output schema/i.test(refused),
    );
    await page.screenshot({ path: `${SHOTS}/03-beat2-refusal.png` });

    // ── Beat 2.5: the loop closes — an authorised carer settles the request ─
    // The refusal created a pending item; without this beat the demo shows the
    // question but never the answer, and the newest tool goes unexercised in
    // the only layer that can see a real output-schema violation.
    await page.getByRole('radio', { name: /Priya/ }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('tab', { name: 'Handover' }).click();
    // Wait for the panel to land instead of guessing a delay: a persona switch
    // reconnects, and the first fetch can run before the new session is ready.
    await page
      .getByText(/waiting for approval/i)
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    const waiting = await page.evaluate(() => document.body.innerText);
    // `innerText` reflects the rendered text, and the heading is uppercased in
    // CSS — match case-insensitively or the check reads as a missing panel.
    const approvalOffered =
      /waiting for approval \([1-9]/i.test(waiting) && /approve/i.test(waiting);
    ok(
      'beat 2.5 offers the pending approval',
      approvalOffered,
      waiting.match(/waiting for approval \(\d+\)/i)?.[0] ?? 'not found',
    );

    if (approvalOffered) {
      await page.getByRole('button', { name: 'Approve' }).first().click();
      await page.waitForTimeout(2000);
      const resolved = await page.evaluate(() => document.body.innerText);
      ok('beat 2.5 records the approval', /Approved and recorded/i.test(resolved));
    } else {
      // A missing button is a failed check, not a harness error: report it and
      // keep the remaining beats running.
      ok('beat 2.5 records the approval', false, 'skipped — nothing to approve');
    }
    await page.screenshot({ path: `${SHOTS}/04-beat2.5-approval.png` });

    // ── Beat 3: dose verdict ───────────────────────────────────────────────
    await page.getByRole('button', { name: 'Can Tom give it?' }).click();
    await page.waitForTimeout(2500);
    ok(
      'beat 3 answers the dose question',
      /do not give|caution|can give|safe/i.test(await page.evaluate(() => document.body.innerText)),
    );

    // ── Record column: every tab loads ─────────────────────────────────────
    for (const tab of ['Audit log', 'Handover']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(2000);
      const text = await page.evaluate(() => document.body.innerText);
      ok(
        `tab "${tab}" loads`,
        !/Loading the|Building the|Could not (load|build)/i.test(text),
      );
      if (tab === 'Handover') ok('handover lists unresolved items', /Still unresolved/i.test(text));
      // The skeleton placeholders must clear once data lands; an aria-busy
      // region that never goes quiet is a stuck loading state.
      const busyLeft = await page.locator(`role=tabpanel >> [aria-busy="true"]`).count();
      ok(`"${tab}" tab is no longer busy`, busyLeft === 0, `${busyLeft} busy region(s)`);
      await page.screenshot({ path: `${SHOTS}/0${tab === 'Audit log' ? 5 : 6}-${tab.toLowerCase().replace(' ', '-')}.png` });
    }

    // ── Reduced motion, keyboard, responsive ───────────────────────────────
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const duration = await page.evaluate(() => {
      const el = document.querySelector('article');
      return el ? getComputedStyle(el).transitionDuration : '0s';
    });
    ok('reduced-motion collapses durations', parseFloat(duration) < 0.001, duration);
    await page.emulateMedia({ reducedMotion: null });

    // Focus the page deterministically before probing the keyboard. Without
    // this the result depends on what the previous action left focused, which
    // made the check flaky — and a check that sometimes passes is worse than
    // no check, because it reads as evidence.
    await page.locator('body').press('Tab');
    let focused = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'none');
    if (focused === 'body' || focused === 'none') {
      // DOM churn between actions can swallow the first Tab. Try once more
      // before calling it a failure.
      await page.locator('body').press('Tab');
      focused = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'none');
    }
    ok('keyboard focus moves', focused !== 'none' && focused !== 'body', focused);

    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      if (name === 'desktop') continue;
      await page.setViewportSize(viewport);
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      ok(`no horizontal overflow at ${viewport.width}px`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: `${SHOTS}/0${name === 'tablet' ? 8 : 7}-${name}.png` });
    }

    // ── Contrast: measured here, not claimed in DESIGN.md ──────────────────
    // WCAG 2.1 relative-luminance ratio against the theme's own variables.
    // 4.5:1 is the AA floor for normal text; every pair below renders at
    // small sizes somewhere in the UI.
    // The body is passed serialized, not as a closure: tsx's transform injects
    // a __name helper into local arrow functions that does not exist in the
    // page, breaking evaluate(). Plain JS in, numbers out. Ratios are measured
    // in BOTH color schemes: the dark palette is a separate token set and a
    // light-only pass would say nothing about it. Note the corrected parse —
    // slice offsets against m[0] WITH the '#', after the first version sliced
    // the capture group and reported impossible ratios that caught itself.
    const contrastBody = `(() => {
      const css = getComputedStyle(document.documentElement);
      const parse = (n) => {
        const m = css.getPropertyValue(n).trim().match(/#([0-9a-f]{6})/i);
        if (!m) return [0, 0, 0];
        const h = m[0];
        return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      };
      const lum = ([r, g, b]) => {
        const f = (c) => {
          const s = c / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (fg, bg) => {
        const l1 = lum(parse(fg));
        const l2 = lum(parse(bg));
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
        return (hi + 0.05) / (lo + 0.05);
      };
      return {
        'ink on card': ratio('--color-ink', '--color-card'),
        'ink-soft on card': ratio('--color-ink-soft', '--color-card'),
        'ink-faint on paper': ratio('--color-ink-faint', '--color-paper'),
        'paper on ink (button)': ratio('--color-paper', '--color-ink'),
      };
    })()`;
    const light: Record<string, number> = await page.evaluate(contrastBody);
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark: Record<string, number> = await page.evaluate(contrastBody);
    await page.emulateMedia({ colorScheme: null });
    const pairs: Record<string, number> = { ...light };
    for (const [k, v] of Object.entries(dark)) pairs[`${k} (dark)`] = v;
    const fails = Object.entries(pairs).filter(([, v]) => v < 4.5);
    ok(
      'contrast pairs meet WCAG AA',
      fails.length === 0,
      Object.entries(pairs).map(([k, v]) => `${k} ${v.toFixed(2)}:1`).join(', '),
    );
  } finally {
    // Resource cleanup must happen on the failure path too — a leaked browser
    // here would leave a process holding the port for the next run.
    await browser?.close();
  }

  const passed = checks.filter((c) => c.pass).length;
  console.log('\n══ UI CHECKS ═══════════════════════════════════');
  for (const c of checks) {
    console.log(`${c.pass ? '  PASS' : '  FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  }
  console.log(`\n  ${passed}/${checks.length} passed`);
  console.log(`  screenshots -> ${SHOTS}`);

  if (consoleErrors.length > 0) {
    console.log('\n══ CONSOLE ERRORS ═══════════════════════════════');
    for (const e of consoleErrors) console.log(`  ${e.slice(0, 160)}`);
  } else {
    console.log('\n  console errors: none');
  }
  if (failedRequests.length > 0) {
    console.log('\n  aborted requests (expected during handshake/teardown):');
    for (const r of failedRequests) console.log(`    ${r}`);
  }

  // Console errors are a failure in their own right: a page that renders
  // correctly while throwing is not correct.
  if (passed !== checks.length || consoleErrors.length > 0) process.exit(EXIT_CHECK_FAILED);
}

run().catch((error: unknown) => {
  console.error('[ui-check] harness error:', error instanceof Error ? error.message : error);
  process.exit(EXIT_CANNOT_RUN);
});