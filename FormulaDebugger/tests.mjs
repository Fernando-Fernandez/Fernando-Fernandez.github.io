// Unit tests for the formula tokenizer/parser/engine.
// Run with: node tests.mjs
import FormulaEngine from './formula_engine.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
