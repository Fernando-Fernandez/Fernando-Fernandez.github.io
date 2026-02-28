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
          if ((node.name || '').toUpperCase() === 'TODAY') variables.add('TODAY()');
          if ((node.name || '').toUpperCase() === 'TIMENOW') variables.add('TIMENOW()');
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
                ok = (lt === FormulaEngine.RESULT_TYPE.Text || rt === FormulaEngine.RESULT_TYPE.Text)
                  || (lt === FormulaEngine.RESULT_TYPE.Number && rt === FormulaEngine.RESULT_TYPE.Number)
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
            case '&': {
              node.resultType = this.RESULT_TYPE.Text;
              break;
            }
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
            case 'BEGINS': node.resultType = this.RESULT_TYPE.Boolean; return node.resultType;
            case 'FIND':
            case 'ABS':
            case 'EXP':
            case 'LN':
            case 'LOG':
            case 'SQRT':
            case 'ROUND':
            case 'MCEILING':
            case 'MFLOOR':
            case 'FLOOR':
            case 'MOD':
            case 'MONTH':
            case 'DAY':
            case 'WEEKDAY':
            case 'HOUR':
            case 'MINUTE':
            case 'SECOND':
            case 'MILLISECOND':
            case 'CEILING': node.resultType = this.RESULT_TYPE.Number; return node.resultType;
            case 'MIN':
            case 'MAX': {
              // If any argument is DateTime -> DateTime, else if any is Date -> Date, else Number
              const hasDateTime = (argTypes || []).includes(this.RESULT_TYPE.DateTime);
              const hasDate = (argTypes || []).includes(this.RESULT_TYPE.Date);
              node.resultType = hasDateTime ? this.RESULT_TYPE.DateTime : (hasDate ? this.RESULT_TYPE.Date : this.RESULT_TYPE.Number);
              return node.resultType;
            }
            case 'YEAR': node.resultType = this.RESULT_TYPE.Number; return node.resultType;
            case 'MID': node.resultType = this.RESULT_TYPE.Text; return node.resultType;
            case 'LEFT':
            case 'RIGHT':
            case 'TRIM':
            case 'LOWER':
            case 'UPPER':
            case 'REVERSE':
            case 'TEXT':
            case 'LPAD':
            case 'RPAD':
            case 'SUBSTITUTE':
              node.resultType = this.RESULT_TYPE.Text; return node.resultType;
            case 'LEN': node.resultType = this.RESULT_TYPE.Number; return node.resultType;
            case 'BLANKVALUE':
            case 'NULLVALUE': {
              if (argTypes.length >= 2) {
                node.resultType = this.unifyTypes(argTypes[0], argTypes[1]);
                return node.resultType;
              }
              node.resultType = argTypes[0] || this.RESULT_TYPE.Unknown;
              return node.resultType;
            }
            case 'VALUE': node.resultType = this.RESULT_TYPE.Number; return node.resultType;
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
            case 'ISBLANK':
            case 'ISNUMBER': node.resultType = this.RESULT_TYPE.Boolean; return node.resultType;
            case 'NOW': node.resultType = this.RESULT_TYPE.DateTime; return node.resultType;
            case 'TIMENOW': node.resultType = this.RESULT_TYPE.DateTime; return node.resultType;
            case 'TODAY': node.resultType = this.RESULT_TYPE.Date; return node.resultType;
            case 'DATE':
            case 'DATEVALUE': node.resultType = this.RESULT_TYPE.Date; return node.resultType;
            case 'DATETIMEVALUE': node.resultType = this.RESULT_TYPE.DateTime; return node.resultType;
            case 'TIMEVALUE': node.resultType = this.RESULT_TYPE.DateTime; return node.resultType;
            case 'ADDMONTHS': node.resultType = this.RESULT_TYPE.Date; return node.resultType;
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
    if (typeof value === 'string') {
      const s = value.trim();
      // Handle US formats explicitly (MM/DD/YYYY [HH:mm[:ss]])
      const usWithTime = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;
      const mTime = s.match(usWithTime);
      if (mTime) {
        const mm = parseInt(mTime[1], 10);
        const dd = parseInt(mTime[2], 10);
        const yyyy = parseInt(mTime[3], 10);
        const HH = parseInt(mTime[4], 10);
        const MM = parseInt(mTime[5], 10);
        const SS = mTime[6] ? parseInt(mTime[6], 10) : 0;
        const d = new Date(yyyy, mm - 1, dd, HH, MM, SS);
        if (!isNaN(d.getTime())) return d;
      }
      const usDateOnly = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      const mDateOnly = s.match(usDateOnly);
      if (mDateOnly) {
        const mm = parseInt(mDateOnly[1], 10);
        const dd = parseInt(mDateOnly[2], 10);
        const yyyy = parseInt(mDateOnly[3], 10);
        const d = new Date(yyyy, mm - 1, dd);
        if (!isNaN(d.getTime())) return d;
      }
      if (this.isDateString(s)) {
        // Normalize space separator to 'T' for consistent parsing for ISO-like strings
        const normalized = s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
        const d = new Date(normalized);
        if (!isNaN(d.getTime())) return d;
      }
    }
    return null;
  }
  // Normalize a Date to ISO string without milliseconds: YYYY-MM-DDTHH:mm:ssZ
  static toIsoZSeconds(d) {
    if (!(d instanceof Date)) return '';
    const iso = d.toISOString();
    return iso.replace(/\.\d{3}Z$/, 'Z');
  }
  static isDate(value) { return value instanceof Date; }
  static isDateString(value) {
    if (typeof value !== 'string' || value.trim() === '') return false;
    const s = value.trim();
    // Accept the following:
    // - YYYY-MM-DDTHH:mm
    // - YYYY-MM-DD HH:mm
    // - YYYY-MM-DDTHH:mm:ssZ (with optional .SSS)
    // - YYYY-MM-DDTHH:mm:ss (with optional .SSS)
    // - YYYY-MM-DD HH:mm:ss
    // - MM/DD/YYYY HH:mm
    // - MM/DD/YYYY HH:mm:ss
    // - MM/DD/YYYY (date only)
    const isoBasic = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/; // with optional seconds and millis
    const isoWithZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/; // explicit Z, optional millis
    const usLike = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    const usWithTime = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?$/;
    if (!(isoBasic.test(s) || isoWithZ.test(s) || usLike.test(s) || usWithTime.test(s))) return false;
    // For ISO-like, normalize space to T; for US-like, leave as-is
    const normalized = isoBasic.test(s) || isoWithZ.test(s)
      ? s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
      : s;
    const date = new Date(normalized);
    return !isNaN(date.getTime()) || usWithTime.test(s);
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
          case 'BEGINS': {
            if (args.length !== 2) throw new Error('BEGINS requires exactly two arguments: text, compare_text');
            const text = args[0] == null ? '' : String(args[0]);
            const compare = args[1] == null ? '' : String(args[1]);
            return text.startsWith(compare);
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
            let startOne = parseInt(args[1] || 1, 10);
            let length = parseInt(args[2] || 0, 10);
            if (!Number.isFinite(startOne) || startOne < 1) startOne = 1;
            if (!Number.isFinite(length) || length <= 0) return '';
            const start = startOne - 1; // convert to 0-based
            const end = start + length;
            return midText.slice(start, end);
          }
          case 'LEFT': {
            if (args.length !== 2) throw new Error('LEFT requires exactly two arguments: text, num_chars');
            const leftText = args[0] == null ? '' : String(args[0]);
            const nRaw = Number(args[1]);
            if (!Number.isFinite(nRaw)) throw new Error('LEFT num_chars must be numeric');
            const count = Math.trunc(nRaw);
            if (count <= 0) return '';
            return leftText.slice(0, count);
          }
          case 'RIGHT': {
            if (args.length !== 2) throw new Error('RIGHT requires exactly two arguments: text, num_chars');
            const rightText = args[0] == null ? '' : String(args[0]);
            const nRaw = Number(args[1]);
            if (!Number.isFinite(nRaw)) throw new Error('RIGHT num_chars must be numeric');
            const count = Math.trunc(nRaw);
            if (count <= 0) return '';
            if (count >= rightText.length) return rightText;
            return rightText.slice(rightText.length - count);
          }
          case 'TRIM': {
            if (args.length !== 1) throw new Error('TRIM requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return '';
            const d = this.toDate(v);
            const textValue = d ? this.toIsoZSeconds(d) : String(v);
            return textValue.trim();
          }
          case 'LEN': {
            if (args.length !== 1) throw new Error('LEN requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return 0;
            const d = this.toDate(v);
            const textValue = d ? this.toIsoZSeconds(d) : String(v);
            return textValue.length;
          }
          case 'TEXT': {
            if (args.length !== 1) throw new Error('TEXT requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return '';
            const d = this.toDate(v);
            // Keep datetimes in normalized ISO format (no locale conversion)
            if (d) return this.toIsoZSeconds(d);
            return String(v);
          }
          case 'LPAD': {
            if (args.length !== 2 && args.length !== 3) throw new Error('LPAD requires two or three arguments: text, padded_length[, pad_string]');
            const input = args[0] == null ? '' : String(args[0]);
            const nRaw = Number(args[1]);
            if (!Number.isFinite(nRaw)) throw new Error('LPAD padded_length must be numeric');
            const targetLen = Math.trunc(nRaw);
            const padStr = (args.length === 3 ? String(args[2] ?? '') : ' ');
            if (targetLen <= 0) return '';
            if (input.length >= targetLen) return input.slice(0, targetLen);
            const need = targetLen - input.length;
            if (padStr.length === 0 && need > 0) throw new Error('LPAD pad_string cannot be empty when padding is needed');
            const left = (padStr.repeat(Math.ceil(need / padStr.length))).slice(0, need);
            return left + input;
          }
          case 'RPAD': {
            if (args.length !== 2 && args.length !== 3) throw new Error('RPAD requires two or three arguments: text, padded_length[, pad_string]');
            const input = args[0] == null ? '' : String(args[0]);
            const nRaw = Number(args[1]);
            if (!Number.isFinite(nRaw)) throw new Error('RPAD padded_length must be numeric');
            const targetLen = Math.trunc(nRaw);
            const padStr = (args.length === 3 ? String(args[2] ?? '') : ' ');
            if (targetLen <= 0) return '';
            if (input.length >= targetLen) return input.slice(0, targetLen);
            const need = targetLen - input.length;
            if (padStr.length === 0 && need > 0) throw new Error('RPAD pad_string cannot be empty when padding is needed');
            const right = (padStr.repeat(Math.ceil(need / padStr.length))).slice(0, need);
            return input + right;
          }
          case 'SUBSTITUTE': {
            if (args.length !== 3 && args.length !== 4) throw new Error('SUBSTITUTE requires three arguments with optional fourth occurrence: text, old_text, new_text[, occurrence]');
            const text = args[0] == null ? '' : String(args[0]);
            const oldText = args[1] == null ? '' : String(args[1]);
            const newText = args[2] == null ? '' : String(args[2]);
            if (oldText === '') return text;
            if (args.length === 3) return text.split(oldText).join(newText);
            const occurrenceRaw = Number(args[3]);
            if (!Number.isFinite(occurrenceRaw)) throw new Error('SUBSTITUTE occurrence must be numeric when provided');
            const occurrence = Math.trunc(occurrenceRaw);
            if (occurrence <= 0) throw new Error('SUBSTITUTE occurrence must be positive');
            let count = 0;
            let idx = -1;
            let start = 0;
            while (start <= text.length) {
              idx = text.indexOf(oldText, start);
              if (idx === -1) break;
              count += 1;
              if (count === occurrence) {
                return text.slice(0, idx) + newText + text.slice(idx + oldText.length);
              }
              start = idx + oldText.length;
            }
            return text;
          }
          case 'LOWER': {
            if (args.length !== 1) throw new Error('LOWER requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return '';
            const d = this.toDate(v);
            const textValue = d ? this.toIsoZSeconds(d) : String(v);
            return textValue.toLowerCase();
          }
          case 'UPPER': {
            if (args.length !== 1) throw new Error('UPPER requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return '';
            const d = this.toDate(v);
            const textValue = d ? this.toIsoZSeconds(d) : String(v);
            return textValue.toUpperCase();
          }
          case 'REVERSE': {
            if (args.length !== 1) throw new Error('REVERSE requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) return '';
            const d = this.toDate(v);
            const textValue = d ? this.toIsoZSeconds(d) : String(v);
            return Array.from(textValue).reverse().join('');
          }
          case 'BLANKVALUE': {
            if (args.length !== 2) throw new Error('BLANKVALUE requires exactly two arguments: expression, substitute');
            const isBlank = (val) => {
              if (val === null || val === undefined) return true;
              if (typeof val === 'string') return val.trim() === '';
              return false;
            };
            const expr = args[0];
            const substitute = args[1];
            return isBlank(expr) ? substitute : expr;
          }
          case 'NULLVALUE': {
            if (args.length !== 2) throw new Error('NULLVALUE requires exactly two arguments: expression, substitute');
            const expr = args[0];
            const substitute = args[1];
            return (expr === null || expr === undefined) ? substitute : expr;
          }
          case 'ISNUMBER': {
            if (args.length !== 1) throw new Error('ISNUMBER requires exactly one argument');
            const value = args[0];
            if (value === null || value === undefined) return false;
            if (typeof value === 'number') return Number.isFinite(value);
            if (typeof value === 'boolean') return false;
            const s = String(value).trim();
            if (s === '') return false;
            const n = Number(s);
            return Number.isFinite(n);
          }
          case 'ABS': {
            if (args.length !== 1) throw new Error('ABS requires exactly one argument');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x)) return 0;
            return Math.abs(x);
          }
          case 'EXP': {
            if (args.length !== 1) throw new Error('EXP requires exactly one argument');
            const x = parseFloat(args[0]);
            const val = Number.isFinite(x) ? x : 0;
            return Math.exp(val);
          }
          case 'LN': {
            if (args.length !== 1) throw new Error('LN requires exactly one argument');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x) || x <= 0) throw new Error('LN expects a positive numeric value');
            return Math.log(x);
          }
          case 'LOG': {
            if (args.length < 1 || args.length > 2) throw new Error('LOG requires one argument with optional base: number[, base]');
            const number = parseFloat(args[0]);
            if (!Number.isFinite(number) || number <= 0) throw new Error('LOG expects a positive numeric value');
            if (args.length === 1) {
              const log10 = Math.log10 ? Math.log10(number) : (Math.log(number) / Math.LN10);
              return log10;
            }
            const base = parseFloat(args[1]);
            if (!Number.isFinite(base) || base <= 0 || base === 1) throw new Error('LOG base must be positive, non-zero, and not equal to 1');
            return Math.log(number) / Math.log(base);
          }
          case 'SQRT': {
            if (args.length !== 1) throw new Error('SQRT requires exactly one argument');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x) || x < 0) throw new Error('SQRT expects a non-negative numeric value');
            return Math.sqrt(x);
          }
          case 'ROUND': {
            if (args.length !== 2) throw new Error('ROUND requires two arguments: number, num_digits');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x)) return 0;
            const digitsRaw = Number(args[1]);
            if (!Number.isFinite(digitsRaw)) throw new Error('ROUND num_digits must be numeric');
            const digits = Math.trunc(digitsRaw);
            const factor = Math.pow(10, digits);
            return Math.round(x * factor) / factor;
          }
          case 'MCEILING': {
            if (args.length !== 2) throw new Error('MCEILING requires two arguments: number, significance');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x)) return 0;
            const significance = parseFloat(args[1]);
            if (!Number.isFinite(significance) || significance === 0) throw new Error('MCEILING significance must be a non-zero numeric value');
            return Math.ceil(x / significance) * significance;
          }
          case 'MFLOOR': {
            if (args.length !== 2) throw new Error('MFLOOR requires two arguments: number, significance');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x)) return 0;
            const significance = parseFloat(args[1]);
            if (!Number.isFinite(significance) || significance === 0) throw new Error('MFLOOR significance must be a non-zero numeric value');
            return Math.floor(x / significance) * significance;
          }
          case 'VALUE': {
            if (args.length !== 1) throw new Error('VALUE requires exactly one argument');
            const v = args[0];
            if (typeof v === 'number') return v;
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (v === null || v === undefined) return 0;
            const s = String(v).trim();
            if (s === '') return 0;
            const n = Number(s);
            if (!Number.isFinite(n)) throw new Error('VALUE expects a numeric text');
            return n;
          }
          case 'FLOOR':
            return Math.floor(parseFloat(args[0]) || 0);
          case 'MOD': {
            if (args.length !== 2) throw new Error('MOD requires exactly two arguments: number and divisor');
            const x = parseFloat(args[0]);
            const y = parseFloat(args[1]);
            const divisor = Number.isFinite(y) ? y : 0;
            if (divisor === 0) throw new Error('Division by zero');
            if (!Number.isFinite(x)) return 0;
            const r = x - divisor * Math.floor(x / divisor);
            return r;
          }
          case 'MONTH': {
            if (args.length !== 1) throw new Error('MONTH requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('MONTH expects a date-like value');
            return d.getMonth() + 1; // 1-12
          }
          case 'DAY': {
            if (args.length !== 1) throw new Error('DAY requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('DAY expects a date-like value');
            return d.getDate(); // 1-31
          }
          case 'WEEKDAY': {
            if (args.length !== 1) throw new Error('WEEKDAY requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('WEEKDAY expects a date-like value');
            return d.getDay() + 1; // 1=Sunday .. 7=Saturday
          }
          case 'HOUR': {
            if (args.length !== 1) throw new Error('HOUR requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('HOUR expects a date-like value');
            return d.getHours();
          }
          case 'MINUTE': {
            if (args.length !== 1) throw new Error('MINUTE requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('MINUTE expects a date-like value');
            return d.getMinutes();
          }
          case 'SECOND': {
            if (args.length !== 1) throw new Error('SECOND requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('SECOND expects a date-like value');
            return d.getSeconds();
          }
          case 'MILLISECOND': {
            if (args.length !== 1) throw new Error('MILLISECOND requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('MILLISECOND expects a date-like value');
            return d.getMilliseconds();
          }
          case 'CEILING': {
            if (args.length !== 1) throw new Error('CEILING requires exactly one argument');
            const x = parseFloat(args[0]);
            if (!Number.isFinite(x)) return 0;
            return Math.ceil(x);
          }
          case 'MIN': {
            if (args.length < 1) throw new Error('MIN requires at least one argument');
            // Determine mode: date-like or numeric
            const dateFlags = args.map(a => this.toDate(a));
            const anyDate = dateFlags.some(d => !!d);
            const allDate = dateFlags.every(d => !!d);
            if (anyDate && !allDate) throw new Error('MIN arguments must all be date-like or all numeric');
            if (allDate) {
              let best = dateFlags[0];
              for (let i = 1; i < dateFlags.length; i++) if (dateFlags[i].getTime() < best.getTime()) best = dateFlags[i];
              return best;
            }
            // numeric
            let min = Infinity;
            for (const v of args) {
              const n = parseFloat(v);
              if (Number.isFinite(n) && n < min) min = n;
            }
            return min === Infinity ? 0 : min;
          }
          case 'MAX': {
            if (args.length < 1) throw new Error('MAX requires at least one argument');
            const dateFlags = args.map(a => this.toDate(a));
            const anyDate = dateFlags.some(d => !!d);
            const allDate = dateFlags.every(d => !!d);
            if (anyDate && !allDate) throw new Error('MAX arguments must all be date-like or all numeric');
            if (allDate) {
              let best = dateFlags[0];
              for (let i = 1; i < dateFlags.length; i++) if (dateFlags[i].getTime() > best.getTime()) best = dateFlags[i];
              return best;
            }
            let max = -Infinity;
            for (const v of args) {
              const n = parseFloat(v);
              if (Number.isFinite(n) && n > max) max = n;
            }
            return max === -Infinity ? 0 : max;
          }
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
              return this.toIsoZSeconds(pd);
            }
            return this.toIsoZSeconds(new Date());
          }
          case 'TIMENOW': {
            if (args.length !== 0) throw new Error('TIMENOW requires no arguments');
            const source = (() => {
              if (variables && variables['TIMENOW()'] !== undefined) {
                const tv = variables['TIMENOW()'];
                if (tv === '') return new Date();
                const pd = new Date(tv);
                if (isNaN(pd.getTime())) throw new Error('Invalid date format for TIMENOW() test value');
                return pd;
              }
              return new Date();
            })();
            const dUtc = new Date(Date.UTC(1970, 0, 1, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds()));
            return dUtc.toISOString();
          }
          case 'TODAY': {
            if (args.length !== 0) throw new Error('TODAY requires no arguments');
            if (variables && variables['TODAY()'] !== undefined) {
              const tv = variables['TODAY()'];
              if (tv === '') {
                const n = new Date();
                return new Date(n.getFullYear(), n.getMonth(), n.getDate());
              }
              const pd = new Date(tv);
              if (isNaN(pd.getTime())) throw new Error('Invalid date format for TODAY() test value');
              return new Date(pd.getFullYear(), pd.getMonth(), pd.getDate());
            }
            const n = new Date();
            return new Date(n.getFullYear(), n.getMonth(), n.getDate());
          }
          case 'DATEVALUE': {
            if (args.length !== 1) throw new Error('DATEVALUE requires exactly one argument');
            const v = args[0];
            if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
            const d = this.toDate(v);
            if (!d) throw new Error('DATEVALUE expects a date-like value');
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
          }
          case 'DATETIMEVALUE': {
            if (args.length !== 1) throw new Error('DATETIMEVALUE requires exactly one argument');
            const v = args[0];
            // If already a Date, return as UTC ISO with seconds
            if (v instanceof Date) return this.toIsoZSeconds(v);
            if (v === null || v === undefined) throw new Error('DATETIMEVALUE expects a datetime string');
            const s = String(v).trim();
            // Expected format: YYYY-MM-DD HH:MM:SS -> interpret as GMT
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
            if (m) {
              const year = parseInt(m[1], 10);
              const month = parseInt(m[2], 10);
              const day = parseInt(m[3], 10);
              const hour = parseInt(m[4], 10);
              const minute = parseInt(m[5], 10);
              const second = parseInt(m[6], 10);
              const dUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
              if (isNaN(dUtc.getTime())) throw new Error('Invalid datetime for DATETIMEVALUE');
              return this.toIsoZSeconds(dUtc);
            }
            // Fallback: try generic parser then normalize to UTC ISO
            const d = this.toDate(s);
            if (!d) throw new Error('DATETIMEVALUE expects text like YYYY-MM-DD HH:MM:SS');
            return this.toIsoZSeconds(d);
          }
          case 'TIMEVALUE': {
            if (args.length !== 1) throw new Error('TIMEVALUE requires exactly one argument');
            const v = args[0];
            if (v === null || v === undefined) throw new Error('TIMEVALUE expects a time or datetime value');
            // If Date provided, extract UTC time components
            if (v instanceof Date) {
              const dUtc = new Date(Date.UTC(1970, 0, 1, v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds(), v.getUTCMilliseconds()));
              return dUtc.toISOString();
            }
            const s = String(v).trim();
            // First try pure time format HH:MM:SS(.MS)
            const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
            if (m) {
              let hh = parseInt(m[1], 10);
              const mm = parseInt(m[2], 10);
              const ss = parseInt(m[3], 10);
              let ms = m[4] ? m[4] : '0';
              if (hh < 0 || hh > 23) throw new Error('TIMEVALUE hour must be 0-23');
              if (mm < 0 || mm > 59) throw new Error('TIMEVALUE minute must be 0-59');
              if (ss < 0 || ss > 59) throw new Error('TIMEVALUE second must be 0-59');
              if (typeof ms === 'string') {
                if (ms.length === 1) ms = String(parseInt(ms, 10) * 100);
                else if (ms.length === 2) ms = String(parseInt(ms, 10) * 10);
              }
              const msi = parseInt(ms, 10) || 0;
              const dUtc = new Date(Date.UTC(1970, 0, 1, hh, mm, ss, msi));
              if (isNaN(dUtc.getTime())) throw new Error('Invalid time for TIMEVALUE');
              return dUtc.toISOString();
            }
            // Otherwise, try parsing as a date-time string and extract time (prefer UTC semantics)
            const mdt = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z)?$/);
            if (mdt) {
              const hh = parseInt(mdt[4], 10);
              const mm = parseInt(mdt[5], 10);
              const ss = parseInt(mdt[6], 10);
              let ms = mdt[7] ? mdt[7] : '0';
              if (typeof ms === 'string') {
                if (ms.length === 1) ms = String(parseInt(ms, 10) * 100);
                else if (ms.length === 2) ms = String(parseInt(ms, 10) * 10);
              }
              const msi = parseInt(ms, 10) || 0;
              const dUtc = new Date(Date.UTC(1970, 0, 1, hh, mm, ss, msi));
              return dUtc.toISOString();
            }
            const d = this.toDate(s);
            if (!d) throw new Error('TIMEVALUE expects HH:MM:SS.MS or a datetime');
            return new Date(Date.UTC(1970, 0, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
          }
          case 'YEAR': {
            if (args.length !== 1) throw new Error('YEAR requires exactly one argument');
            const d = this.toDate(args[0]);
            if (!d) throw new Error('YEAR expects a date-like value');
            return d.getFullYear();
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
          case 'ADDMONTHS': {
            if (args.length !== 2) throw new Error('ADDMONTHS requires exactly two arguments: date, months');
            const base = this.toDate(args[0]);
            if (!base) throw new Error('ADDMONTHS expects a date-like first argument');
            const monthsNum = Number(args[1]);
            if (!Number.isFinite(monthsNum)) throw new Error('ADDMONTHS months must be numeric');
            const months = Math.trunc(monthsNum);
            const y = base.getFullYear();
            const m = base.getMonth();
            const d = base.getDate();
            const h = base.getHours();
            const min = base.getMinutes();
            const s = base.getSeconds();
            const ms = base.getMilliseconds();
            const totalMonths = m + months;
            let ty = y + Math.floor(totalMonths / 12);
            let tm = totalMonths % 12;
            if (tm < 0) { tm += 12; ty -= 1; }
            const daysInTargetMonth = new Date(ty, tm + 1, 0).getDate();
            const day = Math.min(d, daysInTargetMonth);
            return this.toIsoZSeconds(new Date(ty, tm, day, h, min, s, ms));
          }
          default:
            throw new Error(`This tool doesn't yet support the function ${ast.name}`);
        }
      }
      case OPERATOR_TYPE: {
        const left = this.calculate(ast.left, variables);
        const right = this.calculate(ast.right, variables);
        const leftDate = this.toDate(left);
        const rightDate = this.toDate(right);
        const leftTypeHint = ast.left && ast.left.resultType;
        const rightTypeHint = ast.right && ast.right.resultType;
        switch (ast.operator) {
          case '&': {
            const fmt = (v) => {
              if (v === null || v === undefined) return '';
              const d = this.toDate(v);
              if (d) return d.toLocaleString();
              return String(v);
            };
            return fmt(left) + fmt(right);
          }
          case '+': {
            // If either side is Text per type hints, perform string concatenation
            if (leftTypeHint === this.RESULT_TYPE.Text || rightTypeHint === this.RESULT_TYPE.Text) {
              const fmt = (v) => {
                if (v === null || v === undefined) return '';
                const d = this.toDate(v);
                if (d) return d.toLocaleString();
                return String(v);
              };
              return fmt(left) + fmt(right);
            }
            const rightNum = Number(right);
            const leftNum = Number(left);
            if (leftDate && Number.isFinite(rightNum)) return this.toIsoZSeconds(new Date(leftDate.getTime() + (Math.round(rightNum) * 86400000)));
            if (rightDate && Number.isFinite(leftNum)) return this.toIsoZSeconds(new Date(rightDate.getTime() + (Math.round(leftNum) * 86400000)));
            return (parseFloat(left) || 0) + (parseFloat(right) || 0);
          }
          case '-':
            if (leftDate && rightDate) {
              const diffMs = leftDate.getTime() - rightDate.getTime();
              // If either operand is DateTime, return fractional days; if both are Date, return integer days
              const anyDateTime = (leftTypeHint === this.RESULT_TYPE.DateTime) || (rightTypeHint === this.RESULT_TYPE.DateTime);
              return anyDateTime ? (diffMs / 86400000) : Math.round(diffMs / 86400000);
            }
            if (leftDate) {
              const rightNum = Number(right);
              if (Number.isFinite(rightNum)) return this.toIsoZSeconds(new Date(leftDate.getTime() - (Math.round(rightNum) * 86400000)));
            }
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
