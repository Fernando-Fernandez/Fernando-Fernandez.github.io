// Unit tests for the formula tokenizer/parser/engine.
// Run with: node tests.mjs
import FormulaEngine from './formula_engine.js';
import FormulaUI from './formula_ui.js';
import { explainFormula } from './formula_explain.js';
import { generateScenarios } from './formula_matrix.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

function eq(actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`expected ${b}, got ${a}`);
}

function evalFormula(formula, vars = {}, types = {}) {
  const ast = FormulaEngine.parse(formula);
  FormulaEngine.annotateTypes(ast, vars, types);
  return FormulaEngine.calculate(ast, vars);
}

// --- Decimal number literals ---
check('decimal addition', () => eq(evalFormula('1.5 + 0.25'), 1.75));
check('decimal in function argument', () => eq(evalFormula('ROUND(2.5, 0)'), 3));
check('leading-dot decimal', () => eq(evalFormula('.5 * 4'), 2));
check('negative decimal', () => eq(evalFormula('-1.5 - 2'), -3.5));

// --- Dotted field references and global variables ---
check('cross-object field parses as one variable', () => {
  const ast = FormulaEngine.parse("Account.Industry = 'Tech'");
  eq(FormulaEngine.extractVariables(ast), ['Account.Industry']);
});
check('cross-object field evaluates', () =>
  eq(evalFormula("Account.Industry = 'Tech'", { 'Account.Industry': 'Tech' }), true));
check('global variable reference', () =>
  eq(evalFormula("$User.FirstName & '!'", { '$User.FirstName': 'Ann' }), 'Ann!'));

// --- Logical operators && and || ---
check('&& evaluates', () => {
  eq(evalFormula('1 < 2 && 2 < 3'), true);
  eq(evalFormula('1 < 2 && 3 < 2'), false);
});
check('|| evaluates', () => {
  eq(evalFormula('1 = 2 || 2 = 2'), true);
  eq(evalFormula('1 = 2 || 2 = 3'), false);
});
check('&& short-circuits the right side', () =>
  eq(evalFormula('1 = 2 && 1 / 0 > 1'), false));
check('|| short-circuits the right side', () =>
  eq(evalFormula('1 = 1 || 1 / 0 > 1'), true));

// --- Unary minus ---
check('literal times negative literal', () => eq(evalFormula('5 * -1'), -5));
check('negated field', () => eq(evalFormula('-Amount', { Amount: 5 }), -5));
check('negated parenthesized expression', () => eq(evalFormula('-(2 + 3)'), -5));
check('double negation via subtraction', () => eq(evalFormula('1 - -2'), 3));
check('unary minus rebuilds cleanly', () => {
  eq(FormulaEngine.rebuild(FormulaEngine.parse('-Amount')), '-Amount');
  eq(FormulaEngine.rebuild(FormulaEngine.parse('-(1 + 2)')), '-(1 + 2)');
});

// --- Exponent operator ---
check('basic exponent', () => eq(evalFormula('2 ^ 3'), 8));
check('exponent is right-associative', () => eq(evalFormula('2 ^ 3 ^ 2'), 512));
check('exponent binds tighter than multiplication', () => eq(evalFormula('2 * 3 ^ 2'), 18));
check('unary minus binds tighter than exponent', () => eq(evalFormula('-2 ^ 2'), 4));

// --- == as alias for = ---
check('== compares like =', () => {
  eq(evalFormula('5 == 5'), true);
  eq(evalFormula('5 == 6'), false);
});
check('== normalizes to = in rebuilt formula', () =>
  eq(FormulaEngine.rebuild(FormulaEngine.parse('5 == 5')), '5 = 5'));

// --- TRUE/FALSE literals ---
check('TRUE literal in IF', () => eq(evalFormula('IF(TRUE, 1, 2)'), 1));
check('FALSE literal with NOT', () => eq(evalFormula('NOT(FALSE)'), true));
check('boolean literals are not variables', () =>
  eq(FormulaEngine.extractVariables(FormulaEngine.parse('IsActive = true')), ['IsActive']));
check('boolean literal type is Boolean', () => {
  const ast = FormulaEngine.parse('TRUE');
  FormulaEngine.annotateTypes(ast, {}, {});
  eq(ast.resultType, 'Boolean');
});
check('boolean literal rebuilds as TRUE/FALSE', () =>
  eq(FormulaEngine.rebuild(FormulaEngine.parse('IF(true, false, 1)')), 'IF(TRUE, FALSE, 1)'));

// --- Short-circuit evaluation of IF / CASE ---
check('IF does not evaluate the untaken branch', () =>
  eq(evalFormula('IF(Amount = 0, 0, 100 / Amount)', { Amount: 0 }), 0));
check('IF evaluates the taken branch', () =>
  eq(evalFormula('IF(Amount = 0, 0, 100 / Amount)', { Amount: 4 }), 25));
check('CASE does not evaluate untaken results', () =>
  eq(evalFormula("CASE(Level, 'A', 1, 'B', 2, 1 / 0)", { Level: 'A' }), 1));
check('CASE falls through to default', () =>
  eq(evalFormula("CASE(Level, 'A', 1, 'B', 2, 99)", { Level: 'Z' }), 99));

// --- N-ary AND / OR ---
check('AND honors all arguments', () => {
  eq(evalFormula('AND(1 = 1, 2 = 2, 1 = 2)'), false);
  eq(evalFormula('AND(1 = 1, 2 = 2, 3 = 3)'), true);
});
check('OR honors all arguments', () => {
  eq(evalFormula('OR(1 = 2, 1 = 3, 1 = 1)'), true);
  eq(evalFormula('OR(1 = 2, 1 = 3, 1 = 4)'), false);
});
check('AND short-circuits after a false argument', () =>
  eq(evalFormula('AND(1 = 2, 1 / 0 > 1)'), false));
check('OR short-circuits after a true argument', () =>
  eq(evalFormula('OR(1 = 1, 1 / 0 > 1)'), true));

// --- Regressions: existing behavior still works ---
check('sample formula from the page', () =>
  eq(evalFormula("IF((Amount + 50) >= 100, 'OK', 'NO')", { Amount: 60 }), 'OK'));
check('CONTAINS', () => eq(evalFormula("CONTAINS('hello world', 'world')"), true));
check('text concatenation with &', () => eq(evalFormula("'a' & 'b'"), 'ab'));
check('nested functions', () =>
  eq(evalFormula("UPPER(LEFT('salesforce', 5))"), 'SALES'));
check('comparison operators', () => {
  eq(evalFormula('3 <= 3'), true);
  eq(evalFormula('3 <> 4'), true);
  eq(evalFormula('3 != 3'), false);
});
check('date difference in days', () =>
  eq(evalFormula('CloseDate - CreatedDate', { CloseDate: '1/10/2026', CreatedDate: '1/3/2026' },
    { CloseDate: 'Date', CreatedDate: 'Date' }), 7));
check('division by zero still throws when evaluated', () => {
  let threw = false;
  try { evalFormula('1 / 0'); } catch (_) { threw = true; }
  eq(threw, true);
});

// --- New functions: ISNULL, INCLUDES, REGEX, CASESAFEID, TRUNC ---
check('ISNULL', () => {
  eq(evalFormula('ISNULL(X)', { X: null }), true);
  eq(evalFormula('ISNULL(NULL)'), true);
  eq(evalFormula("ISNULL('a')"), false);
  eq(evalFormula('ISNULL(0)'), false);
});
check('INCLUDES on multiselect picklist', () => {
  eq(evalFormula("INCLUDES(Colors, 'Red')", { Colors: 'Red;Blue' }), true);
  eq(evalFormula("INCLUDES(Colors, 'Green')", { Colors: 'Red;Blue' }), false);
  eq(evalFormula("INCLUDES(Colors, 'Red')", { Colors: null }), false);
});
check('REGEX matches the entire string', () => {
  eq(evalFormula("REGEX('123-45-6789', '[0-9]{3}-[0-9]{2}-[0-9]{4}')"), true);
  eq(evalFormula("REGEX('abc123', '[0-9]+')"), false);
  eq(evalFormula("REGEX('123', '[0-9]+')"), true);
});
check('REGEX rejects invalid patterns', () => {
  let threw = false;
  try { evalFormula("REGEX('a', '[')"); } catch (_) { threw = true; }
  eq(threw, true);
});
check('CASESAFEID computes the 18-character suffix', () => {
  eq(evalFormula("CASESAFEID('aaaaaaaaaaaaaaa')"), 'aaaaaaaaaaaaaaaAAA');
  eq(evalFormula("CASESAFEID('AAAAAaaaaaaaaaa')"), 'AAAAAaaaaaaaaaa5AA');
  eq(evalFormula("CASESAFEID('aaaaaaaaaaaaaaaAAA')"), 'aaaaaaaaaaaaaaaAAA');
});
check('TRUNC truncates toward zero', () => {
  eq(evalFormula('TRUNC(2.9)'), 2);
  eq(evalFormula('TRUNC(-2.9)'), -2);
  eq(evalFormula('TRUNC(123.456, 2)'), 123.45);
});

// --- Salesforce rounding parity on negatives ---
check('ROUND rounds half away from zero', () => {
  eq(evalFormula('ROUND(2.5, 0)'), 3);
  eq(evalFormula('ROUND(-2.5, 0)'), -3);
  eq(evalFormula('ROUND(-1.45, 1)'), -1.5);
});
check('CEILING rounds away from zero when negative', () => {
  eq(evalFormula('CEILING(2.1)'), 3);
  eq(evalFormula('CEILING(-2.1)'), -3);
});
check('FLOOR rounds toward zero when negative', () => {
  eq(evalFormula('FLOOR(2.9)'), 2);
  eq(evalFormula('FLOOR(-2.9)'), -2);
});
check('MCEILING/MFLOOR use math semantics', () => {
  eq(evalFormula('MCEILING(2.1)'), 3);
  eq(evalFormula('MCEILING(-2.5)'), -2);
  eq(evalFormula('MFLOOR(2.9)'), 2);
  eq(evalFormula('MFLOOR(-2.5)'), -3);
});

// --- Memoized evaluation ---
check('calculate accepts a per-node memoization cache', () => {
  const ast = FormulaEngine.parse('(Amount + 1) * (Amount + 1)');
  const cache = new Map();
  eq(FormulaEngine.calculate(ast, { Amount: 2 }, cache), 9);
  eq(cache.size > 0, true);
  // Cached nodes return the same results on re-evaluation
  eq(FormulaEngine.calculate(ast, { Amount: 2 }, cache), 9);
  eq(FormulaEngine.calculate(ast.left, { Amount: 2 }, cache), 3);
});
check('calculate without a cache is unchanged', () =>
  eq(FormulaEngine.calculate(FormulaEngine.parse('2 + 3')), 5));

// --- Null field values (null checkbox support) ---
check('coerceVariables passes null through regardless of type', () => {
  const out = FormulaUI.coerceVariables({ A: null, B: '5' }, { A: 'Text', B: 'Number' });
  eq(out.A, null);
  eq(out.B, 5);
});
check('null field values flow through NULLVALUE and ISNULL', () => {
  eq(evalFormula('NULLVALUE(X, 7)', { X: null }), 7);
  eq(evalFormula('ISNULL(X)', { X: null }), true);
  eq(evalFormula('ISBLANK(X)', { X: null }), true);
});

// --- Encoding and markup functions ---
check('BR returns a line break', () => eq(evalFormula("'a' & BR() & 'b'"), 'a\nb'));
check('HTMLENCODE', () =>
  eq(evalFormula("HTMLENCODE('<a & \"b\">')"), '&lt;a &amp; &quot;b&quot;&gt;'));
check('JSENCODE', () =>
  eq(evalFormula("JSENCODE('he said \"hi\"')"), 'he said \\"hi\\"'));
check('JSINHTMLENCODE is JSENCODE(HTMLENCODE(text))', () => {
  // HTML encoding runs first, so the apostrophe becomes &#39; and there is
  // nothing left for JSENCODE to escape
  eq(evalFormula('JSINHTMLENCODE("a\'b")'), 'a&#39;b');
  // A backslash survives HTML encoding and is then JS-escaped (doubled)
  eq(evalFormula("JSINHTMLENCODE('a\\b & c')"), 'a\\\\b &amp; c');
});
check('URLENCODE uses form encoding', () =>
  eq(evalFormula("URLENCODE('a b&c')"), 'a+b%26c'));
check('HYPERLINK builds an anchor', () => {
  eq(evalFormula("HYPERLINK('https://example.com', 'Example')"), '<a href="https://example.com">Example</a>');
  eq(evalFormula("HYPERLINK('https://example.com', 'Example', '_blank')"), '<a href="https://example.com" target="_blank">Example</a>');
});
check('IMAGE builds an img tag', () => {
  eq(evalFormula("IMAGE('https://x/y.png', 'pic')"), '<img src="https://x/y.png" alt="pic">');
  eq(evalFormula("IMAGE('https://x/y.png', 'pic', 50, 100)"), '<img src="https://x/y.png" alt="pic" height="50" width="100">');
});

// --- Geolocation ---
function approx(actual, expected, tolerance) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
    throw new Error(`expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}
check('DISTANCE between GEOLOCATION points (SF to LA)', () => {
  approx(evalFormula("DISTANCE(GEOLOCATION(37.7749, -122.4194), GEOLOCATION(34.0522, -118.2437), 'mi')"), 347.4, 2);
  approx(evalFormula("DISTANCE(GEOLOCATION(37.7749, -122.4194), GEOLOCATION(34.0522, -118.2437), 'km')"), 559, 3);
});
check("DISTANCE accepts 'lat,lon' field values", () =>
  approx(evalFormula("DISTANCE(Location__c, GEOLOCATION(34.0522, -118.2437), 'km')", { Location__c: '37.7749,-122.4194' }), 559, 3));
check('DISTANCE rejects unknown units', () => {
  let threw = false;
  try { evalFormula("DISTANCE(GEOLOCATION(0, 0), GEOLOCATION(1, 1), 'ft')"); } catch (_) { threw = true; }
  eq(threw, true);
});

// --- Plain-English explainer ---
check('explainer renders IF as an indented block', () =>
  eq(explainFormula(FormulaEngine.parse("IF(Amount > 1000, 'High', 'Low')")),
    'If Amount is greater than 1000:\n  return "High"\nOtherwise:\n  return "Low"'));
check('explainer renders CASE as an indented block', () =>
  eq(explainFormula(FormulaEngine.parse("CASE(Level, 'A', 1, 'B', 2, 0)")),
    'Check Level:\n  when it is "A": return 1\n  when it is "B": return 2\n  otherwise: return 0'));
check('explainer handles non-branching formulas', () =>
  eq(explainFormula(FormulaEngine.parse('Amount * 2')), 'Returns Amount times 2.'));
check('explainer parenthesizes nested operator phrases', () => {
  const text = explainFormula(FormulaEngine.parse("IF((Amount + 50) >= 100 && ISBLANK(Name), 'OK', 'NO')"));
  eq(text.includes('(Amount plus 50) is at least 100'), true);
  eq(text.includes('Name is blank'), true);
});
check('explainer nests IF inside IF', () => {
  const text = explainFormula(FormulaEngine.parse("IF(A > 1, IF(B > 2, 'x', 'y'), 'z')"));
  eq(text,
    'If A is greater than 1:\n  If B is greater than 2:\n    return "x"\n  Otherwise:\n    return "y"\nOtherwise:\n  return "z"');
});
check('explainer describes functions in plain English', () => {
  const text = explainFormula(FormulaEngine.parse('ROUND(Amount / 3, 2)'));
  eq(text, 'Returns (Amount divided by 3) rounded to 2 decimal places.');
});
check('explainer falls back for unknown functions', () =>
  eq(explainFormula(FormulaEngine.parse('VLOOKUP(A, B, C)')), 'Returns the result of VLOOKUP(A, B, C).'));

// --- Static arity validation (Analyze-time checks) ---
function arityErrors(formula) {
  return FormulaEngine.collectArityErrors(FormulaEngine.parse(formula));
}
check('flags too many arguments', () => {
  const errs = arityErrors('MCEILING(Amount, 4)');
  eq(errs.length, 1);
  eq(errs[0].message, 'MCEILING expects exactly 1 argument, but got 2');
});
check('flags too few arguments', () => {
  const errs = arityErrors("IF(Amount > 1, 'yes')");
  eq(errs.length, 1);
  eq(errs[0].message, 'IF expects exactly 3 arguments, but got 2');
});
check('flags zero-argument functions called with arguments', () => {
  eq(arityErrors('TODAY(1)')[0].message, 'TODAY expects exactly 0 arguments, but got 1');
});
check('flags CASE with an incomplete pair', () => {
  // 5 args = expression + one pair + a dangling value with no result/default
  const errs = arityErrors("CASE(Level, 'A', 1, 'B', 2)");
  eq(errs.length, 1);
  eq(errs[0].message.includes('value/result pairs'), true);
  // 4 args (expression + pair + default) is the minimal valid shape
  eq(arityErrors("CASE(Level, 'A', 1, 'B')").length, 0);
});
check('flags IMAGE with three arguments', () => {
  eq(arityErrors("IMAGE('u', 'a', 50)")[0].message, 'IMAGE expects 2 or 4 arguments, but got 3');
});
check('flags AND below its minimum', () => {
  eq(arityErrors('AND(1 = 1)')[0].message, 'AND expects at least 2 arguments, but got 1');
});
check('flags unsupported functions', () => {
  eq(arityErrors('VLOOKUP(A, B, C)')[0].message, 'VLOOKUP is not supported by this tool');
});
check('finds errors nested inside expressions', () => {
  const errs = arityErrors("IF(LEN(Name, 2) > 0, TRIM(), 'x')");
  eq(errs.length, 2);
  eq(errs[0].message, 'LEN expects exactly 1 argument, but got 2');
  eq(errs[1].message, 'TRIM expects exactly 1 argument, but got 0');
});
check('accepts optional-argument ranges', () => {
  eq(arityErrors("FIND('a', 'abc')").length, 0);
  eq(arityErrors("FIND('a', 'abc', 2)").length, 0);
  eq(arityErrors("FIND('a', 'abc', 2, 9)")[0].message, 'FIND expects between 2 and 3 arguments, but got 4');
});
check('valid formulas produce no arity errors', () => {
  eq(arityErrors("IF(ISBLANK(Name), 'x', LEFT(Name, 3)) & TEXT(ROUND(Amount, 2))").length, 0);
  eq(arityErrors("DISTANCE(GEOLOCATION(1, 2), GEOLOCATION(3, 4), 'km')").length, 0);
});

// --- Boundary candidate mining ---
function boundaries(formula) {
  return FormulaEngine.collectBoundaryCandidates(FormulaEngine.parse(formula));
}
function valuesFor(cands, field) {
  return (cands[field] || []).map(c => c.value);
}
check('numeric comparison yields boundary triple', () => {
  eq(valuesFor(boundaries('Amount > 1000'), 'Amount'), [999, 1000, 1001]);
});
check('decimal comparison steps by its precision', () => {
  eq(valuesFor(boundaries('Rate >= 10.25'), 'Rate'), [10.24, 10.25, 10.26]);
});
check('field on the right side also gets boundaries', () => {
  eq(valuesFor(boundaries('100 <= Amount'), 'Amount'), [99, 100, 101]);
});
check('constant side is folded, not just literals', () => {
  eq(valuesFor(boundaries('Amount > 10 * 10'), 'Amount'), [99, 100, 101]);
});
check('text match yields exact, case-flipped, and non-matching values', () => {
  const vals = valuesFor(boundaries("CONTAINS(Name, 'VIP')"), 'Name');
  eq(vals.includes('VIP'), true);
  eq(vals.includes('vip'), true);
  eq(vals.includes('unrelated'), true);
});
check('INCLUDES adds a multi-select combination', () => {
  eq(valuesFor(boundaries("INCLUDES(Colors, 'Red')"), 'Colors').includes('Red;Other'), true);
});
check('divisor fields get zero', () => {
  eq(valuesFor(boundaries('100 / Amount'), 'Amount'), [0]);
  eq(valuesFor(boundaries('MOD(Total, Divisor)'), 'Divisor'), [0]);
});
check('CASE values and a computed no-match are mined', () => {
  const vals = valuesFor(boundaries("CASE(Level, 'A', 1, 'B', 2, 0)"), 'Level');
  eq(vals.includes('A'), true);
  eq(vals.includes('B'), true);
  eq(vals.includes('unmatched'), true);
  const nums = valuesFor(boundaries('CASE(Tier, 1, 10, 2, 20, 0)'), 'Tier');
  eq(nums.includes(3), true); // max + 1
});
check('date comparison against TODAY yields day-before/same/day-after', () => {
  const vals = valuesFor(boundaries('CloseDate < TODAY()'), 'CloseDate');
  eq(vals.length, 3);
  eq(vals.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v)), true);
});
check('LEFT count yields shorter/exact/longer strings', () => {
  eq(valuesFor(boundaries("LEFT(Code, 3) = 'abc'"), 'Code').includes('xx'), true);
  eq(valuesFor(boundaries("LEFT(Code, 3) = 'abc'"), 'Code').includes('xxxx'), true);
});
check('no boundary candidates for field-to-field comparisons', () => {
  eq(Object.keys(boundaries('Amount > Target')).length, 0);
});

// --- Scenario generation ---
check('scenario fields exclude NOW()/TODAY() pseudo-variables', () => {
  const gen = generateScenarios(FormulaEngine.parse('IF(CloseDate < TODAY(), Amount, 0)'), {}, {});
  eq(gen.fields.sort(), ['Amount', 'CloseDate']);
});
check('first row is the current values baseline', () => {
  const gen = generateScenarios(FormulaEngine.parse('Amount > 1000'), {}, { Amount: '500' });
  eq(gen.rows[0].reason, 'current values');
  eq(gen.rows[0].values.Amount, '500');
});
check('boundary rows come right after the baseline', () => {
  const gen = generateScenarios(FormulaEngine.parse('Amount > 1000'), {}, {});
  const boundaryValues = gen.rows.slice(1, 4).map(r => r.values.Amount);
  eq(boundaryValues, [999, 1000, 1001]);
});
check('multi-field formulas get combined specials', () => {
  const gen = generateScenarios(FormulaEngine.parse("Amount > 1 && Name = 'x'"), {}, {});
  eq(gen.rows.some(r => r.reason === 'all fields null' && r.values.Amount === null && r.values.Name === null), true);
});
check('typed fields get type-specific candidates', () => {
  const gen = generateScenarios(FormulaEngine.parse('Amount * 2'), { Amount: 'Number' }, {});
  const vals = gen.rows.map(r => r.values.Amount);
  eq(vals.includes(-1), true);
  eq(vals.includes(999999999), true);
});
check('date candidates are computed from the injected clock', () => {
  const gen = generateScenarios(FormulaEngine.parse('D < TODAY()'), { D: 'Date' },
    {}, { now: '2026-02-15T12:00:00' });
  const vals = gen.rows.map(r => r.values.D);
  eq(vals.includes('2026-02-15'), true); // today
  eq(vals.includes('2026-02-28'), true); // last day of month
  eq(vals.includes('2028-02-29'), true); // nearest leap day
});
check('rows are deduplicated and capped', () => {
  const gen = generateScenarios(
    FormulaEngine.parse("A > 1 && B > 2 && C > 3 && D = 'x' && E = 'y'"), {}, {}, { maxRows: 20 });
  eq(gen.rows.length, 20);
  eq(gen.truncated, true);
  const keys = gen.rows.map(r => JSON.stringify(r.values));
  eq(new Set(keys).size, keys.length);
});
check('boundary mining honors TODAY() test values', () => {
  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shift = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
  const pseudo = { 'TODAY()': '2026-01-01' };
  // Expected center: whatever the engine itself evaluates TODAY() to with
  // this test value (avoids timezone assumptions in the test)
  const today = FormulaEngine.calculate(FormulaEngine.parse('TODAY()'), pseudo);
  const cands = FormulaEngine.collectBoundaryCandidates(FormulaEngine.parse('CloseDate < TODAY()'), pseudo);
  eq(cands.CloseDate.map(c => c.value),
    [localIso(shift(today, -1)), localIso(today), localIso(shift(today, 1))]);
});
check('generator clock follows the TODAY() test value', () => {
  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pseudo = { 'TODAY()': '2026-01-01' };
  const today = FormulaEngine.calculate(FormulaEngine.parse('TODAY()'), pseudo);
  const gen = generateScenarios(FormulaEngine.parse('D < TODAY()'), { D: 'Date' }, pseudo);
  const vals = gen.rows.map(r => r.values.D);
  // Mined boundary row sits on the test date (the tier-2 "today" template
  // produces the same value and is deduplicated into the boundary row)
  eq(vals.includes(localIso(today)), true);
  eq(gen.rows.some(r => r.reason === 'D: same day as value in D < TODAY()'), true);
  // Month-boundary template proves tier 2 uses the test clock, not the real
  // one (last day: the first-of-month value collides with the mined boundary
  // row on Jan 1 and is deduplicated into it)
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  eq(gen.rows.some(r => r.reason === 'D: last day of this month' && r.values.D === localIso(endOfMonth)), true);
});
check('date-only strings parse as local dates, not UTC', () => {
  // new Date('YYYY-MM-DD') is UTC midnight, which is the previous day in
  // timezones west of UTC; the engine must treat these as local dates
  eq(evalFormula("DAY(DATEVALUE('2026-01-01'))"), 1);
  eq(evalFormula('DAY(TODAY())', { 'TODAY()': '2026-01-01' }), 1);
  eq(evalFormula('MONTH(TODAY())', { 'TODAY()': '2026-01-01' }), 1);
  eq(evalFormula('YEAR(TODAY())', { 'TODAY()': '2026-01-01' }), 2026);
});
check('matrix evaluation applies the calculator type checks', () => {
  const res = FormulaUI.evaluateScenarioResult(
    FormulaEngine.parse('CloseDate > Amount'),
    { CloseDate: '2026-01-01', Amount: '5' },
    { CloseDate: 'Date', Amount: 'Number' });
  eq(res, 'Type error: Date > Number');
  eq(FormulaUI.evaluateScenarioResult(FormulaEngine.parse('Amount > 5'), { Amount: '7' }, { Amount: 'Number' }), 'true');
  eq(FormulaUI.evaluateScenarioResult(FormulaEngine.parse('1 / Amount'), { Amount: '0' }, { Amount: 'Number' }), 'Error: Division by zero');
});
check('DateTime candidates are valid datetime-local values', () => {
  const gen = generateScenarios(FormulaEngine.parse('D + 1'), { D: 'DateTime' }, {}, { now: '2026-02-15T12:00:00' });
  const vals = gen.rows.map(r => r.values.D).filter(v => typeof v === 'string' && v !== '');
  eq(vals.length > 0, true);
  eq(vals.every(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)), true);
  eq(vals.includes('2026-02-15T23:59'), true); // end-of-day boundary
});
check('generated rows surface both guarded and unguarded cases', () => {
  const ast = FormulaEngine.parse("IF(Amount = 0, 'none', 100 / Amount)");
  const gen = generateScenarios(ast, { Amount: 'Number' }, {});
  const results = gen.rows.map(row => {
    const coerced = FormulaUI.coerceVariables(row.values, { Amount: 'Number' });
    try { return FormulaEngine.calculate(ast, coerced, new Map()); }
    catch (e) { return `Error: ${e.message}`; }
  });
  // The zero boundary is caught by the formula's own guard
  eq(results[gen.rows.findIndex(r => r.values.Amount === 0)], 'none');
  eq(results[gen.rows.findIndex(r => r.values.Amount === 1)], 100);
  // ...but null is not zero, so the null row exposes an unguarded division —
  // exactly the kind of finding the matrix exists to surface
  eq(results[gen.rows.findIndex(r => r.values.Amount === null)], 'Error: Division by zero');
});

// --- Copy-paste artifact tolerance ---
check('invisible characters are treated as whitespace', () => {
  // zero-width space, word joiner, LTR mark, BOM — typical web-page paste debris
  eq(evalFormula('IF(​ISPICKVAL(⁠Rating,‎ "Hot"﻿), 1, 0)', { Rating: 'Hot' }), 1);
});
check('curly double quotes delimit strings', () => {
  eq(evalFormula('IF(ISPICKVAL(Rating, “Hot”), 1, 0)', { Rating: 'Hot' }), 1);
  eq(evalFormula('IF(ISPICKVAL(Rating, “Hot”), 1, 0)', { Rating: 'Cold' }), 0);
});
check('curly single quotes delimit strings', () => {
  eq(evalFormula('‘abc’ & ‘def’'), 'abcdef');
});
check('the pasted Salesforce CASE example works with curly quotes', () => {
  const formula = 'CASE(1, IF( ISPICKVAL( Rating, “Hot”), 1, 0), 3, '
    + 'IF( ISPICKVAL( Rating, “Warm”), 1, 0), 2, '
    + 'IF( ISPICKVAL( Rating, “Cold”), 1, 0), 1, 0)';
  eq(evalFormula(formula, { Rating: 'Warm' }), 2);
  eq(evalFormula(formula, { Rating: 'Hot' }), 3);
  eq(evalFormula(formula, { Rating: 'Nope' }), 0);
});
check('unexpected characters report their code point', () => {
  let message = '';
  try { FormulaEngine.parse('Amount § 5'); } catch (e) { message = e.message; }
  eq(message.includes('(U+00A7)'), true);
});
check('extra closing parenthesis still reports a clear error', () => {
  let message = '';
  try { FormulaEngine.parse("IF(ISPICKVAL(Rating, “Hot”), 1, 0))"); } catch (e) { message = e.message; }
  eq(message.includes("without matching '('"), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
