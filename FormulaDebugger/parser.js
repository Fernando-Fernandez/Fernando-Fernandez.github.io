import Tokenizer from './tokenizer.js';

// Export shared AST/token constants here so both Parser and
// FormulaEngine can import from a single place without an extra module.
export const OPERATOR_TYPE = 'Operator';
export const LITERAL_TYPE = 'Literal';
export const PARENTHESIS_TYPE = 'PARENTHESIS';

export default class Parser {
  constructor() {
    this._string = '';
    this._tokenizer = new Tokenizer();
    this._tokens = [];
    this._currentIndex = 0;
  }

  // Tokenize input, filter trivia, check parens, then parse
  parse(string) {
    this._string = string;
    this._tokenizer.initialize(this._string);
    this._tokens = [];
    this._currentIndex = 0;

    while (this._tokenizer.hasMoreTokens()) {
      const token = this._tokenizer.getNextToken();
      const isTrivia = (
        !token ||
        token.tokenType === 'WHITESPACE' ||
        token.tokenType === 'SINGLE_LINE_COMMENT' ||
        token.tokenType === 'MULTI_LINE_COMMENT'
      );
      if (!isTrivia) this._tokens.push(token);
    }

    this._tokenizer.checkParenthesesBalance();
    return this.parseExpression();
  }

  // Look at current token without consuming
  peek() {
    return this._currentIndex < this._tokens.length
      ? this._tokens[this._currentIndex]
      : null;
  }

  // Consume and return current token, validating type if provided
  consume(expectedType = null) {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of input');
    if (expectedType && token.tokenType !== expectedType) {
      throw new Error(`Expected ${expectedType} at ${this._currentIndex}, got ${token.tokenType}`);
    }
    this._currentIndex++;
    return token;
  }

  // Lowest precedence: logical AND/OR
  parseExpression() {
    let node = this.parseEquality();
    while (this.peek() && (this.peek().token === '&&' || this.peek().token === '||')) {
      const operator = this.consume().token;
      const right = this.parseEquality();
      node = { type: OPERATOR_TYPE, operator, left: node, right };
    }
    return node;
  }

  // Comparison and equality operators
  parseEquality() {
    let node = this.parseTerm();
    while (
      this.peek() && (
        this.peek().token === '=' ||
        this.peek().token === '!=' ||
        this.peek().token === '<>' ||
        this.peek().token === '<' ||
        this.peek().token === '>' ||
        this.peek().token === '<=' ||
        this.peek().token === '>='
      )
    ) {
      const operator = this.consume().token;
      const right = this.parseTerm();
      node = { type: OPERATOR_TYPE, operator, left: node, right };
    }
    return node;
  }

  // Add/Subtract
  parseTerm() {
    let node = this.parseFactor();
    while (this.peek() && (this.peek().token === '+' || this.peek().token === '-' || this.peek().token === '&')) {
      const operator = this.consume().token;
      const right = this.parseFactor();
      node = { type: OPERATOR_TYPE, operator, left: node, right };
    }
    return node;
  }

  // Multiply/Divide
  parseFactor() {
    let node = this.parsePrimary();
    while (this.peek() && (this.peek().token === '*' || this.peek().token === '/')) {
      const operator = this.consume().token;
      const right = this.parsePrimary();
      node = { type: OPERATOR_TYPE, operator, left: node, right };
    }
    return node;
  }

  // Literals, identifiers (fields), function calls, parenthesized expressions
  parsePrimary() {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of input');

    if (token.tokenType === 'NUMBER') {
      return { type: LITERAL_TYPE, value: parseFloat(this.consume().token) };
    }
    if (token.tokenType === 'STRING' || token.tokenType === 'DOUBLE_QUOTE_STRING') {
      return { type: LITERAL_TYPE, value: this.consume().token.slice(1, -1) };
    }
    if (token.tokenType === 'NULL') {
      this.consume();
      return { type: LITERAL_TYPE, value: null };
    }
    if (token.tokenType === 'IDENTIFIER') {
      const name = this.consume().token;
      if (this.peek() && this.peek().token === '(') {
        this.consume(PARENTHESIS_TYPE);
        const args = [];
        while (this.peek() && this.peek().token !== ')') {
          args.push(this.parseExpression());
          if (this.peek() && this.peek().token === ',') {
            this.consume('COMMA');
          } else {
            break;
          }
        }
        this.consume(PARENTHESIS_TYPE);
        return { type: 'Function', name, arguments: args };
      }
      return { type: 'Field', name };
    }
    if (token.token === '(') {
      this.consume(PARENTHESIS_TYPE);
      const expr = this.parseExpression();
      this.consume(PARENTHESIS_TYPE);
      return expr;
    }

    throw new Error(`Unexpected token: ${token.token}`);
  }
}
