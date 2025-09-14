export default class Tokenizer {
    // Lightweight regex-based tokenizer for Salesforce formulas.
    static TOKEN_PATTERNS = [
        [/^\s+/, 'WHITESPACE'],
        [/^"[^"]*"/, 'DOUBLE_QUOTE_STRING'],
        [/^\d+/, 'NUMBER'],
        [/^'[^']*'/, 'STRING'],
        [/^\/\/.*/, 'SINGLE_LINE_COMMENT'],
        [/^\/\*[\s\S]*?\*\//, 'MULTI_LINE_COMMENT'],
        [/^[+\-]/, 'ADDITIVE_OPERATOR'],
        [/^&/, 'CONCAT'],
        [/^[*\/]/, 'MULTIPLICATIVE_OPERATOR'],
        [/^[()]/, 'PARENTHESIS'],
        [/^[{}]/, 'BRACES'],
        [/^,/, 'COMMA'],
        [/^&&/, 'AND'],
        [/^\|\|/, 'OR'],
        [/^=/, 'EQUAL'],
        [/^!=/, 'NOT_EQUAL'],
        [/^<>/, 'NOT_EQUAL'],
        [/^<=/, 'LESS_THAN_OR_EQUAL'],
        [/^>=/, 'GREATER_THAN_OR_EQUAL'],
        [/^</, 'LESS_THAN'],
        [/^>/, 'GREATER_THAN'],
        [/^NULL\b/i, 'NULL'],
        [/^[a-zA-Z_]\w*/, 'IDENTIFIER']
    ];

    initialize(inputString) {
        this._expression = inputString;
        this._currentPos = 0;
        this._parenStack = [];
    }
    hasMoreTokens() { return this._currentPos < this._expression.length; }
    getNextToken() {
        if (!this.hasMoreTokens()) return null;
        const remainingPart = this._expression.slice(this._currentPos);
        for (const [regExpression, tokenType] of Tokenizer.TOKEN_PATTERNS) {
            const token = this.findMatch(regExpression, remainingPart);
            if (token != null) {
                const tokenStartPos = this._currentPos;
                this._currentPos += token.length;
                if (token === '(') this._parenStack.push(tokenStartPos);
                else if (token === ')') {
                    if (this._parenStack.length === 0) {
                        const expressionSnippet = this._expression.slice(Math.max(0, tokenStartPos - 10), tokenStartPos + 10);
                        throw new Error(`Unexpected closing parenthesis at position ${tokenStartPos + 1}: ')' without matching '('. Near: '${expressionSnippet}'`);
                    }
                    this._parenStack.pop();
                }
                return { tokenType, token };
            }
        }
        const pos = this._currentPos + 1;
        const expressionSnippet = this._expression.slice(Math.max(0, pos - 10), pos + 10);
        throw new Error(`Unexpected character at position ${pos}: '${remainingPart[0]}'. Near: '${expressionSnippet}'`);
    }
    findMatch(regExpression, remainingPart) {
        const theMatch = remainingPart.match(regExpression);
        return theMatch ? theMatch[0] : null;
    }
    checkParenthesesBalance() {
        if (this._parenStack.length > 0) {
            const lastOpenPos = this._parenStack[this._parenStack.length - 1] + 1;
            const expressionSnippet = this._expression.slice(Math.max(0, lastOpenPos - 10), lastOpenPos + 10);
            throw new Error(`Missing closing parenthesis for opening parenthesis at position ${lastOpenPos}. Near: '${expressionSnippet}'`);
        }
    }
}
