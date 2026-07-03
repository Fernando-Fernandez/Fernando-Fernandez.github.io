// Unit tests for the formula tokenizer/parser/engine.
// Run with: node tests.mjs
import FormulaEngine from './formula_engine.js';
import FormulaUI from './formula_ui.js';
import { explainFormula } from './formula_explain.js';

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
check('JSINHTMLENCODE', () =>
  eq(evalFormula('JSINHTMLENCODE("a\'b")'), 'a\\&#39;b'));
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
