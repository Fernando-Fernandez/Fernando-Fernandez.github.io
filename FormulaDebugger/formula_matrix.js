// Scenario generation for the scenario matrix.
// generateScenarios(ast, types, baseline) builds one-at-a-time rows: a
// baseline from the current field values, then one row per (field, candidate)
// varying a single field, so a changed result is attributable to one change.
// Candidates come from three tiers:
//   1. static per-type templates (0, -1, empty text, markup, true/false, ...)
//   2. date templates computed at generation time (today, month end, leap day)
//   3. adversarial values mined from the formula's own AST via
//      FormulaEngine.collectBoundaryCandidates (comparison boundaries,
//      case-flipped match strings, zero divisors)
import FormulaEngine from './formula_engine.js';

const MAX_ROWS = 60;
const LONG_TEXT = 'x'.repeat(300);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function nearestLeapDay(from) {
  let y = from.getFullYear();
  while (!isLeapYear(y)) y++;
  return `${y}-02-29`;
}

// Tier 2: templates are fixed, concrete values are computed from `now`
// so they never go stale
function dateCandidates(now) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [
    { value: isoDate(now), reason: 'today' },
    { value: isoDate(addDays(now, -1)), reason: 'yesterday' },
    { value: isoDate(addDays(now, 1)), reason: 'tomorrow' },
    { value: isoDate(startOfMonth), reason: 'first day of this month' },
    { value: isoDate(endOfMonth), reason: 'last day of this month' },
    { value: `${now.getFullYear()}-12-31`, reason: 'end of year' },
    { value: `${now.getFullYear() + 1}-01-01`, reason: 'start of next year' },
    { value: nearestLeapDay(now), reason: 'leap day' },
  ];
}

// Tier 1: static per-type adversarial values
function typeCandidates(type, now) {
  switch (type) {
    case 'Number':
      return [
        { value: 0, reason: 'zero' },
        { value: 1, reason: 'one' },
        { value: -1, reason: 'negative' },
        { value: 0.5, reason: 'fraction' },
        { value: -0.5, reason: 'negative fraction' },
        { value: 999999999, reason: 'very large number' },
      ];
    case 'Boolean':
      return [
        { value: true, reason: 'true' },
        { value: false, reason: 'false' },
      ];
    case 'Date':
    case 'DateTime':
      return dateCandidates(now);
    case 'Text':
      return [
        { value: '', reason: 'empty text' },
        { value: ' ', reason: 'whitespace only' },
        { value: 'a', reason: 'single character' },
        { value: LONG_TEXT, reason: 'long text (300 chars)' },
        { value: 'it\'s "quoted" <b>markup</b>', reason: 'quotes and markup' },
        { value: '123', reason: 'numeric-looking text' },
      ];
    default: // Auto: type unknown, probe the coercion paths
      return [
        { value: '', reason: 'empty value' },
        { value: '0', reason: 'zero' },
        { value: '123', reason: 'numeric-looking text' },
        { value: 'text', reason: 'plain text' },
      ];
  }
}

export function generateScenarios(ast, types = {}, baseline = {}, options = {}) {
  const allVars = FormulaEngine.extractVariables(ast);
  const fields = allVars.filter(v => !v.endsWith('()'));

  // Pseudo-variable test values (NOW()/TODAY()/TIMENOW()) ride along in the
  // baseline; mined boundaries and date templates must use the same clock the
  // rows will be evaluated against, not the real one
  const pseudos = {};
  for (const [k, v] of Object.entries(baseline)) {
    if (k.endsWith('()') && v !== undefined && v !== null && v !== '') pseudos[k] = v;
  }

  const clockSource = options.now
    || pseudos['TODAY()']
    || pseudos['NOW()'];
  const clockDate = clockSource ? FormulaEngine.toDate(clockSource) : null;
  const now = clockDate || new Date();

  const maxRows = options.maxRows || MAX_ROWS;
  const boundary = FormulaEngine.collectBoundaryCandidates(ast, pseudos);

  const base = {};
  for (const f of fields) base[f] = baseline[f] !== undefined ? baseline[f] : '';

  const rows = [];
  const seen = new Set();
  let truncated = false;
  const push = (values, reason) => {
    const key = JSON.stringify(fields.map(f => [typeof values[f], values[f]]));
    if (seen.has(key)) return;
    if (rows.length >= maxRows) {
      truncated = true;
      return;
    }
    seen.add(key);
    rows.push({ values, reason });
  };

  push({ ...base }, 'current values');

  // Tier 3 first: formula-derived boundaries are the highest-value rows
  for (const f of fields) {
    for (const c of boundary[f] || []) {
      push({ ...base, [f]: c.value }, `${f}: ${c.reason}`);
    }
  }

  // Combined specials
  if (fields.length > 1) {
    push(Object.fromEntries(fields.map(f => [f, null])), 'all fields null');
    push(Object.fromEntries(fields.map(f => [f, ''])), 'all fields empty');
  }

  // Tiers 1 + 2 per field, plus null for every field
  for (const f of fields) {
    push({ ...base, [f]: null }, `${f}: null`);
    for (const c of typeCandidates(types[f] || 'Auto', now)) {
      push({ ...base, [f]: c.value }, `${f}: ${c.reason}`);
    }
  }

  return { fields, rows, truncated };
}

export default generateScenarios;
