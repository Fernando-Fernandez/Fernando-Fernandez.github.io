// Plain-English explanation of a formula AST.
// explainFormula(ast) returns indented text: IF/CASE render as multi-line
// blocks, everything else as inline phrases.

const OPERATOR_PHRASES = {
  '=': 'equals',
  '!=': 'is not equal to',
  '<>': 'is not equal to',
  '<': 'is less than',
  '>': 'is greater than',
  '<=': 'is at most',
  '>=': 'is at least',
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'divided by',
  '^': 'raised to the power of',
};

function literalPhrase(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function joinList(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Parenthesize nested operator expressions so phrases read unambiguously:
// (Amount plus 50) is at least 100
function operandPhrase(node) {
  const p = phrase(node);
  if (node && node.type === 'Operator' && !node.unary) return `(${p})`;
  return p;
}

function phrase(node) {
  if (!node) return '';
  switch (node.type) {
    case 'Literal':
      return literalPhrase(node.value);
    case 'Field':
      return node.name;
    case 'Operator': {
      if (node.unary) return `the negative of ${operandPhrase(node.right)}`;
      const op = node.operator;
      if (op === '&&') return `${operandPhrase(node.left)} and ${operandPhrase(node.right)}`;
      if (op === '||') return `${operandPhrase(node.left)} or ${operandPhrase(node.right)}`;
      if (op === '&') return `${operandPhrase(node.left)} joined with ${operandPhrase(node.right)}`;
      const words = OPERATOR_PHRASES[op] || op;
      return `${operandPhrase(node.left)} ${words} ${operandPhrase(node.right)}`;
    }
    case 'Function':
      return functionPhrase(node);
    default:
      return '(unknown expression)';
  }
}

function functionPhrase(node) {
  const name = (node.name || '').toUpperCase();
  const a = (node.arguments || []).map(operandPhrase);
  switch (name) {
    case 'IF':
      return a.length === 3 ? `(if ${a[0]} then ${a[1]}, otherwise ${a[2]})` : defaultPhrase(node, a);
    case 'CASE': {
      if (a.length < 4) return defaultPhrase(node, a);
      const parts = [];
      for (let i = 1; i < a.length - 1; i += 2) parts.push(`when it is ${a[i]} then ${a[i + 1]}`);
      return `(check ${a[0]}: ${parts.join('; ')}; otherwise ${a[a.length - 1]})`;
    }
    case 'AND': return a.join(' and ');
    case 'OR': return a.join(' or ');
    case 'NOT': return `it is not true that ${a[0]}`;
    case 'ISBLANK': return `${a[0]} is blank`;
    case 'ISNULL': return `${a[0]} is null`;
    case 'ISNUMBER': return `${a[0]} is a number`;
    case 'ISPICKVAL': return `the picklist ${a[0]} equals ${a[1]}`;
    case 'CONTAINS': return `${a[0]} contains ${a[1]}`;
    case 'BEGINS': return `${a[0]} begins with ${a[1]}`;
    case 'INCLUDES': return `the multi-select ${a[0]} includes ${a[1]}`;
    case 'REGEX': return `${a[0]} matches the pattern ${a[1]}`;
    case 'LEN': return `the length of ${a[0]}`;
    case 'LEFT': return `the first ${a[1]} characters of ${a[0]}`;
    case 'RIGHT': return `the last ${a[1]} characters of ${a[0]}`;
    case 'MID': return `${a[2]} characters of ${a[0]} starting at position ${a[1]}`;
    case 'TRIM': return `${a[0]} without surrounding spaces`;
    case 'LOWER': return `${a[0]} in lowercase`;
    case 'UPPER': return `${a[0]} in uppercase`;
    case 'REVERSE': return `${a[0]} reversed`;
    case 'TEXT': return `${a[0]} as text`;
    case 'VALUE': return `${a[0]} as a number`;
    case 'FIND': return `the position of ${a[0]} within ${a[1]}`;
    case 'SUBSTITUTE': return `${a[0]} with each ${a[1]} replaced by ${a[2]}`;
    case 'LPAD': return `${a[0]} left-padded to ${a[1]} characters`;
    case 'RPAD': return `${a[0]} right-padded to ${a[1]} characters`;
    case 'CASESAFEID': return `the 18-character version of the ID ${a[0]}`;
    case 'BLANKVALUE': return `${a[0]}, or ${a[1]} if it is blank`;
    case 'NULLVALUE': return `${a[0]}, or ${a[1]} if it is null`;
    case 'ABS': return `the absolute value of ${a[0]}`;
    case 'ROUND': return `${a[0]} rounded to ${a[1]} decimal places`;
    case 'TRUNC': return a.length === 2 ? `${a[0]} truncated to ${a[1]} decimal places` : `${a[0]} truncated to a whole number`;
    case 'CEILING':
    case 'MCEILING': return `${a[0]} rounded up to a whole number`;
    case 'FLOOR':
    case 'MFLOOR': return `${a[0]} rounded down to a whole number`;
    case 'SQRT': return `the square root of ${a[0]}`;
    case 'EXP': return `e raised to ${a[0]}`;
    case 'LN': return `the natural log of ${a[0]}`;
    case 'LOG': return a.length === 2 ? `the log of ${a[0]} in base ${a[1]}` : `the base-10 log of ${a[0]}`;
    case 'MOD': return `the remainder of ${a[0]} divided by ${a[1]}`;
    case 'MIN': return `the smallest of ${joinList(a)}`;
    case 'MAX': return `the largest of ${joinList(a)}`;
    case 'NOW': return 'the current date and time';
    case 'TODAY': return "today's date";
    case 'TIMENOW': return 'the current time';
    case 'YEAR': return `the year of ${a[0]}`;
    case 'MONTH': return `the month number of ${a[0]}`;
    case 'DAY': return `the day of the month of ${a[0]}`;
    case 'WEEKDAY': return `the day of the week of ${a[0]} (1 = Sunday)`;
    case 'HOUR': return `the hour of ${a[0]}`;
    case 'MINUTE': return `the minute of ${a[0]}`;
    case 'SECOND': return `the second of ${a[0]}`;
    case 'MILLISECOND': return `the millisecond of ${a[0]}`;
    case 'DATE': return `the date ${a[0]}-${a[1]}-${a[2]}`;
    case 'DATEVALUE': return `${a[0]} as a date`;
    case 'DATETIMEVALUE': return `${a[0]} as a date/time (GMT)`;
    case 'TIMEVALUE': return `the time portion of ${a[0]}`;
    case 'ADDMONTHS': return `${a[0]} plus ${a[1]} months`;
    case 'BR': return 'a line break';
    case 'HTMLENCODE': return `${a[0]} with HTML characters encoded`;
    case 'JSENCODE': return `${a[0]} with JavaScript characters escaped`;
    case 'JSINHTMLENCODE': return `${a[0]} escaped for JavaScript inside HTML`;
    case 'URLENCODE': return `${a[0]} encoded for use in a URL`;
    case 'HYPERLINK': return `a link to ${a[0]} labeled ${a[1]}`;
    case 'IMAGE': return `the image at ${a[0]}`;
    case 'GEOLOCATION': return `the location at latitude ${a[0]}, longitude ${a[1]}`;
    case 'DISTANCE': {
      const unit = a[2] === '"mi"' ? 'miles' : (a[2] === '"km"' ? 'kilometers' : a[2]);
      return `the distance between ${a[0]} and ${a[1]} in ${unit}`;
    }
    default:
      return defaultPhrase(node, a);
  }
}

function defaultPhrase(node, argPhrases) {
  return `the result of ${node.name}(${argPhrases.join(', ')})`;
}

// IF/CASE get their own indented block so branching structure stays readable
function isStructural(node) {
  if (!node || node.type !== 'Function') return false;
  const name = (node.name || '').toUpperCase();
  return (name === 'IF' && (node.arguments || []).length === 3)
    || (name === 'CASE' && (node.arguments || []).length >= 4);
}

function indent(depth) {
  return '  '.repeat(depth);
}

function explainBlock(node, depth) {
  const lines = [];
  const pushBranch = (child, d) => {
    if (isStructural(child)) lines.push(...explainBlock(child, d));
    else lines.push(`${indent(d)}return ${phrase(child)}`);
  };

  if (isStructural(node)) {
    const name = node.name.toUpperCase();
    const args = node.arguments;
    if (name === 'IF') {
      lines.push(`${indent(depth)}If ${phrase(args[0])}:`);
      pushBranch(args[1], depth + 1);
      lines.push(`${indent(depth)}Otherwise:`);
      pushBranch(args[2], depth + 1);
    } else { // CASE
      lines.push(`${indent(depth)}Check ${phrase(args[0])}:`);
      for (let i = 1; i < args.length - 1; i += 2) {
        if (isStructural(args[i + 1])) {
          lines.push(`${indent(depth + 1)}when it is ${phrase(args[i])}:`);
          lines.push(...explainBlock(args[i + 1], depth + 2));
        } else {
          lines.push(`${indent(depth + 1)}when it is ${phrase(args[i])}: return ${phrase(args[i + 1])}`);
        }
      }
      const dflt = args[args.length - 1];
      if (isStructural(dflt)) {
        lines.push(`${indent(depth + 1)}otherwise:`);
        lines.push(...explainBlock(dflt, depth + 2));
      } else {
        lines.push(`${indent(depth + 1)}otherwise: return ${phrase(dflt)}`);
      }
    }
  } else {
    lines.push(`${indent(depth)}Returns ${phrase(node)}.`);
  }
  return lines;
}

export function explainFormula(ast) {
  if (!ast) return '';
  return explainBlock(ast, 0).join('\n');
}

export default explainFormula;
