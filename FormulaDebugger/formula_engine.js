import Parser, { OPERATOR_TYPE, LITERAL_TYPE } from './parser.js';

export default class FormulaEngine {
  static RESULT_TYPE = {
    Text: 'Text',
    Number: 'Number',
    Boolean: 'Boolean',
    Date: 'Date',
    DateTime: 'DateTime',
    Unknown: 'Unknown'
  };

  // Parse formula to AST
  static parse(formula) {
    const p = new Parser();
    return p.parse(formula);
  }

  // Gather referenced variables (field names, and special NOW())
  static extractVariables(ast) {
    const variables = new Set();
    (function traverse(node) {
      if (!node) return;
      switch (node.type) {
        case 'Field':
          variables.add(node.name);
          break;
        case 'Function':
          if ((node.name || '').toUpperCase() === 'NOW') variables.add('NOW()');
          (node.arguments || []).forEach(traverse);
          break;
        case OPERATOR_TYPE:
          traverse(node.left);
          traverse(node.right);
          break;
        case LITERAL_TYPE:
          break;
        default:
          throw new Error(`Unknown AST node type: ${node.type}`);
      }
    })(ast);
    return Array.from(variables);
  }

  // Type helpers
  static inferLiteralResultType(value) {
    if (value === null || value === undefined) return this.RESULT_TYPE.Unknown;
    if (typeof value === 'number') return this.RESULT_TYPE.Number;
    if (typeof value === 'string') return this.RESULT_TYPE.Text;
    if (this.isDate(value)) return this.RESULT_TYPE.DateTime;
    return this.RESULT_TYPE.Unknown;
  }

  static unifyTypes(a, b) {
    if (!a) return b || this.RESULT_TYPE.Unknown;
    if (!b) return a || this.RESULT_TYPE.Unknown;
    if (a === b) return a;
    if (a === this.RESULT_TYPE.Text || b === this.RESULT_TYPE.Text) return this.RESULT_TYPE.Text;
    if ((a === this.RESULT_TYPE.Date && b === this.RESULT_TYPE.Number) ||
        (b === this.RESULT_TYPE.Date && a === this.RESULT_TYPE.Number)) return this.RESULT_TYPE.Date;
    if ((a === this.RESULT_TYPE.DateTime && b === this.RESULT_TYPE.Number) ||
        (b === this.RESULT_TYPE.DateTime && a === this.RESULT_TYPE.Number)) return this.RESULT_TYPE.DateTime;
    if (a === this.RESULT_TYPE.Unknown) return b;
    if (b === this.RESULT_TYPE.Unknown) return a;
    return this.RESULT_TYPE.Unknown;
  }

  static isComparisonOperator(op) {
    return op === '=' || op === '!=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=';
  }

  static collectComparisonTypeErrors(ast) {
    const errors = [];
    (function walk(node) {
      if (!node) return;
      if (node.type === OPERATOR_TYPE) {
        if (FormulaEngine.isComparisonOperator(node.operator)) {
          const lt = node.left && node.left.resultType;
          const rt = node.right && node.right.resultType;
          const bothKnown = lt && rt && lt !== FormulaEngine.RESULT_TYPE.Unknown && rt !== FormulaEngine.RESULT_TYPE.Unknown;
          if (bothKnown && lt !== rt) {
            errors.push({ operator: node.operator, leftType: lt, rightType: rt, expression: FormulaEngine.rebuild(node) });
          }
        }
        walk(node.left);
        walk(node.right);
      } else if (node.type === 'Function') {
        (node.arguments || []).forEach(walk);
      }
    })(ast);
    return errors;
  }

  // Validate arithmetic operator operand type compatibility for +, -, *, /
  static collectArithmeticTypeErrors(ast) {
    const errors = [];
    const isKnown = (t) => t && t !== FormulaEngine.RESULT_TYPE.Unknown;
    const isDateLike = (t) => t === FormulaEngine.RESULT_TYPE.Date || t === FormulaEngine.RESULT_TYPE.DateTime;

    (function walk(node) {
      if (!node) return;
      if (node.type === OPERATOR_TYPE) {
        const op = node.operator;
        if (op === '+' || op === '-' || op === '*' || op === '/') {
          const lt = node.left && node.left.resultType;
          const rt = node.right && node.right.resultType;
          if (isKnown(lt) && isKnown(rt)) {
            let ok = false;
            switch (op) {
              case '+':
                ok = (lt === FormulaEngine.RESULT_TYPE.Number && rt === FormulaEngine.RESULT_TYPE.Number)
                  || (isDateLike(lt) && rt === FormulaEngine.RESULT_TYPE.Number)
                  || (lt === FormulaEngine.RESULT_TYPE.Number && isDateLike(rt));
                break;
              case '-':
                ok = (lt === FormulaEngine.RESULT_TYPE.Number && rt === FormulaEngine.RESULT_TYPE.Number)
                  || (isDateLike(lt) && isDateLike(rt))
                  || (isDateLike(lt) && rt === FormulaEngine.RESULT_TYPE.Number);
                break;
              case '*':
              case '/':
                ok = (lt === FormulaEngine.RESULT_TYPE.Number && rt === FormulaEngine.RESULT_TYPE.Number);
                break;
            }
            if (!ok) {
              errors.push({ operator: op, leftType: lt, rightType: rt, expression: FormulaEngine.rebuild(node) });
            }
          }
        }
        walk(node.left);
        walk(node.right);
      } else if (node.type === 'Function') {
        (node.arguments || []).forEach(walk);
      }
    })(ast);
    return errors;
  }

  // Annotate nodes with resultType; optionally honor user-provided sample types/values
  static annotateTypes(ast, sampleVariables = {}, sampleTypes = {}) {
    const infer = (node) => {
      if (!node) return FormulaEngine.RESULT_TYPE.Unknown;
      switch (node.type) {
        case LITERAL_TYPE: {
          node.resultType = this.inferLiteralResultType(node.value);
          return node.resultType;
        }
        case 'Field': {
          const explicitType = sampleTypes && sampleTypes[node.name];
          if (explicitType && FormulaEngine.RESULT_TYPE[explicitType]) {
            node.resultType = FormulaEngine.RESULT_TYPE[explicitType];
            return node.resultType;
          }
          const v = sampleVariables[node.name];
          if (v === undefined || v === null || v === '') {
            node.resultType = FormulaEngine.RESULT_TYPE.Unknown;
          } else if (typeof v === 'number') {
            node.resultType = FormulaEngine.RESULT_TYPE.Number;
          } else if (this.isDate(v)) {
            node.resultType = FormulaEngine.RESULT_TYPE.DateTime;
          } else if (typeof v === 'string') {
            const dt = this.toDate(v);
            if (dt) {
              node.resultType = v.includes('T') ? FormulaEngine.RESULT_TYPE.DateTime : FormulaEngine.RESULT_TYPE.Date;
            } else if (!isNaN(parseFloat(v))) {
              node.resultType = FormulaEngine.RESULT_TYPE.Number;
            } else {
              node.resultType = FormulaEngine.RESULT_TYPE.Text;
            }
          } else {
            node.resultType = FormulaEngine.RESULT_TYPE.Unknown;
          }
          return node.resultType;
        }
        case OPERATOR_TYPE: {
          const lt = infer(node.left);
          const rt = infer(node.right);
          switch (node.operator) {
            case '&&':
            case '||':
            case '=':
            case '!=':
            case '<>':
            case '<':
            case '>':
            case '<=':
            case '>=':
              node.resultType = FormulaEngine.RESULT_TYPE.Boolean;
              break;
            case '+': {
              if (lt === this.RESULT_TYPE.Text || rt === this.RESULT_TYPE.Text) node.resultType = this.RESULT_TYPE.Text;
              else if (lt === this.RESULT_TYPE.Date && rt === this.RESULT_TYPE.Number) node.resultType = this.RESULT_TYPE.Date;
              else if (lt === this.RESULT_TYPE.Number && rt === this.RESULT_TYPE.Date) node.resultType = this.RESULT_TYPE.Date;
              else if (lt === this.RESULT_TYPE.DateTime && rt === this.RESULT_TYPE.Number) node.resultType = this.RESULT_TYPE.DateTime;
              else if (lt === this.RESULT_TYPE.Number && rt === this.RESULT_TYPE.DateTime) node.resultType = this.RESULT_TYPE.DateTime;
              else node.resultType = this.RESULT_TYPE.Number;
              break;
            }
            case '-': {
              if ((lt === this.RESULT_TYPE.Date || lt === this.RESULT_TYPE.DateTime) && (rt === this.RESULT_TYPE.Date || rt === this.RESULT_TYPE.DateTime)) {
                node.resultType = this.RESULT_TYPE.Number;
              } else if ((lt === this.RESULT_TYPE.Date || lt === this.RESULT_TYPE.DateTime) && rt === this.RESULT_TYPE.Number) {
                node.resultType = lt;
              } else {
                node.resultType = this.RESULT_TYPE.Number;
              }
              break;
            }
            case '*':
            case '/':
              node.resultType = this.RESULT_TYPE.Number;
              break;
            default:
              node.resultType = this.RESULT_TYPE.Unknown;
          }
          return node.resultType;
        }
        case 'Function': {
          const name = node.name ? node.name.toUpperCase() : '';
          const argTypes = (node.arguments || []).map(a => infer(a));
          switch (name) {
            case 'IF':
              if (argTypes.length >= 3) return (node.resultType = this.unifyTypes(argTypes[1], argTypes[2]));
              node.resultType = this.RESULT_TYPE.Unknown; return node.resultType;
            case 'CONTAINS': node.resultType = this.RESULT_TYPE.Boolean; return node.resultType;
            case 'FIND':
            case 'FLOOR': node.resultType = this.RESULT_TYPE.Number; return node.resultType;
            case 'MID': node.resultType = this.RESULT_TYPE.Text; return node.resultType;
            case 'CASE':
              if (argTypes.length >= 3) {
                let t = this.RESULT_TYPE.Unknown;
                for (let i = 2; i < argTypes.length; i += 2) t = this.unifyTypes(t, argTypes[i]);
                if ((argTypes.length - 1) % 2 === 1) t = this.unifyTypes(t, argTypes[argTypes.length - 1]);
                node.resultType = t; return t;
              }
              node.resultType = this.RESULT_TYPE.Unknown; return node.resultType;
            case 'AND':
            case 'OR':
            case 'NOT':
            case 'ISPICKVAL':
            case 'ISBLANK': node.resultType = this.RESULT_TYPE.Boolean; return node.resultType;
            case 'NOW': node.resultType = this.RESULT_TYPE.DateTime; return node.resultType;
            case 'DATE':
            case 'DATEVALUE': node.resultType = this.RESULT_TYPE.Date; return node.resultType;
            default: node.resultType = this.RESULT_TYPE.Unknown; return node.resultType;
          }
        }
        default:
          return FormulaEngine.RESULT_TYPE.Unknown;
      }
    };
    infer(ast);
    return ast;
  }

  // Rebuild an AST back to a formula string
  static rebuild(ast) {
    if (!ast || !ast.type) return '';
    switch (ast.type) {
      case 'Function': {
        const args = ast.arguments.map(arg => this.rebuild(arg)).join(', ');
        return `${ast.name}(${args})`;
      }
      case OPERATOR_TYPE: {
        const left = this.rebuild(ast.left);
        const right = this.rebuild(ast.right);
        return `${left} ${ast.operator} ${right}`;
      }
      case 'Field':
        return ast.name;
      case LITERAL_TYPE:
        if (ast.value === null) return 'null';
        if (typeof ast.value === 'string') return `"${ast.value}"`;
        return ast.value.toString();
      default:
        throw new Error(`Unknown AST node type: ${ast.type}`);
    }
  }

  // Date utilities
  static toDate(value) {
    if (this.isDate(value)) return value;
    if (this.isDateString(value)) return new Date(value);
    return null;
  }
  static isDate(value) { return value instanceof Date; }
  static isDateString(value) {
    if (typeof value !== 'string' || value.trim() === '') return false;
    const s = value.trim();
    const isoLike = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;
    const usLike = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    if (!(isoLike.test(s) || usLike.test(s))) return false;
    const date = new Date(s);
    return !isNaN(date.getTime());
  }

  // Evaluate AST locally with provided variables
  static calculate(ast, variables = {}) {
    if (!ast) return null;
    switch (ast.type) {
      case 'Function': {
        const args = ast.arguments.map(arg => this.calculate(arg, variables));
        switch ((ast.name || '').toUpperCase()) {
          case 'IF':
            return args[0] ? args[1] : args[2];
          case 'CONTAINS': {
            const text = String(args[0] || '');
            const substring = String(args[1] || '');
            return text.includes(substring);
          }
          case 'FIND': {
            const findText = String(args[1] || '');
            const findSubstring = String(args[0] || '');
            const startPos = args[2] ? parseInt(args[2]) - 1 : 0;
            const pos = findText.indexOf(findSubstring, startPos);
            return pos === -1 ? 0 : pos + 1;
          }
          case 'MID': {
            const midText = String(args[0] || '');
            const start = parseInt(args[1] || 1) - 1;
            const length = parseInt(args[2] || 0);
            return midText.substr(start, length);
          }
          case 'FLOOR':
            return Math.floor(parseFloat(args[0]) || 0);
          case 'CASE': {
            const expr = args[0];
            for (let i = 1; i < args.length - 1; i += 2) {
              if (args[i] === expr) return args[i + 1];
            }
            return args[args.length - 1];
          }
          case 'AND':
            return Boolean(args[0]) && Boolean(args[1]);
          case 'OR':
            return Boolean(args[0]) || Boolean(args[1]);
          case 'NOT': {
            if (args.length !== 1) throw new Error('NOT requires exactly one argument');
            return !Boolean(args[0]);
          }
          case 'ISPICKVAL': {
            if (args.length !== 2) throw new Error('ISPICKVAL requires exactly two arguments: field and value');
            return String(args[0] || '') === String(args[1] || '');
          }
          case 'ISBLANK': {
            if (args.length !== 1) throw new Error('ISBLANK requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return true;
            return String(v).trim() === '';
          }
          case 'NOW': {
            if (args.length !== 0) throw new Error('NOW requires no arguments');
            if (variables && variables['NOW()'] !== undefined) {
              const tv = variables['NOW()'];
              if (tv === '') return new Date();
              const pd = new Date(tv);
              if (isNaN(pd.getTime())) throw new Error('Invalid date format for NOW() test value');
              return pd;
            }
            return new Date();
          }
          case 'DATEVALUE': {
            if (args.length !== 1) throw new Error('DATEVALUE requires exactly one argument');
            const v = args[0];
            if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
            const d = this.toDate(v);
            if (!d) throw new Error('DATEVALUE expects a date-like value');
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
          }
          case 'DATE': {
            if (args.length !== 3) throw new Error('DATE requires exactly three arguments: year, month, day');
            const y = parseInt(args[0], 10);
            const m = parseInt(args[1], 10);
            const d = parseInt(args[2], 10);
            if ([y, m, d].some(v => isNaN(v))) throw new Error('DATE arguments must be numeric');
            if (m < 1 || m > 12) throw new Error('DATE month must be between 1 and 12');
            if (d < 1 || d > 31) throw new Error('DATE day must be between 1 and 31');
            return new Date(y, m - 1, d);
          }
          default:
            throw new Error(`This tool doesn't support the function ${ast.name}`);
        }
      }
      case OPERATOR_TYPE: {
        const left = this.calculate(ast.left, variables);
        const right = this.calculate(ast.right, variables);
        const leftDate = this.toDate(left);
        const rightDate = this.toDate(right);
        switch (ast.operator) {
          case '+':
            if (leftDate && typeof right === 'number') return new Date(leftDate.getTime() + (right * 86400000));
            if (typeof left === 'number' && rightDate) return new Date(rightDate.getTime() + (left * 86400000));
            return (parseFloat(left) || 0) + (parseFloat(right) || 0);
          case '-':
            if (leftDate && rightDate) {
              const diffMs = leftDate.getTime() - rightDate.getTime();
              return diffMs / 86400000;
            }
            if (leftDate && typeof right === 'number') return new Date(leftDate.getTime() - (right * 86400000));
            return (parseFloat(left) || 0) - (parseFloat(right) || 0);
          case '*':
            return (parseFloat(left) || 0) * (parseFloat(right) || 0);
          case '/': {
            const divisor = parseFloat(right) || 0;
            if (divisor === 0) throw new Error('Division by zero');
            return (parseFloat(left) || 0) / divisor;
          }
          case '&&':
            return Boolean(left) && Boolean(right);
          case '||':
            return Boolean(left) || Boolean(right);
          case '=':
            if (leftDate && rightDate) return leftDate.getTime() === rightDate.getTime();
            return left === right;
          case '<>':
          case '!=':
            if (leftDate && rightDate) return leftDate.getTime() !== rightDate.getTime();
            return left !== right;
          case '<':
            if (leftDate && rightDate) return leftDate.getTime() < rightDate.getTime();
            return (parseFloat(left) || 0) < (parseFloat(right) || 0);
          case '>':
            if (leftDate && rightDate) return leftDate.getTime() > rightDate.getTime();
            return (parseFloat(left) || 0) > (parseFloat(right) || 0);
          case '<=':
            if (leftDate && rightDate) return leftDate.getTime() <= rightDate.getTime();
            return (parseFloat(left) || 0) <= (parseFloat(right) || 0);
          case '>=':
            if (leftDate && rightDate) return leftDate.getTime() >= rightDate.getTime();
            return (parseFloat(left) || 0) >= (parseFloat(right) || 0);
          default:
            throw new Error(`Unsupported operator: ${ast.operator}`);
        }
      }
      case 'Field': {
        const fieldValue = variables[ast.name] !== undefined ? variables[ast.name] : '';
        if (typeof fieldValue === 'string' && fieldValue.trim() !== '') {
          const dateValue = this.toDate(fieldValue);
          if (dateValue) return dateValue;
        }
        return fieldValue;
      }
      case LITERAL_TYPE:
        return ast.value;
      default:
        throw new Error(`Unknown AST node type: ${ast.type}`);
    }
  }

  // De-duplicated list of intermediate expressions for UI
  static extractCalculationSteps(ast) {
    const steps = [];
    const seen = new Set();
    (function traverse(node) {
      if (!node) return;
      switch (node.type) {
        case 'Function': {
          (node.arguments || []).forEach(arg => traverse(arg));
          const expr = FormulaEngine.rebuild(node);
          if (!seen.has(expr)) { seen.add(expr); steps.push({ expression: expr, node }); }
          break;
        }
        case OPERATOR_TYPE: {
          traverse(node.left);
          traverse(node.right);
          const opExpr = FormulaEngine.rebuild(node);
          if (!seen.has(opExpr)) { seen.add(opExpr); steps.push({ expression: opExpr, node }); }
          break;
        }
        case 'Field':
        case LITERAL_TYPE:
          break;
        default:
          throw new Error(`Unknown AST node type: ${node.type}`);
      }
    })(ast);
    return steps;
  }
}
