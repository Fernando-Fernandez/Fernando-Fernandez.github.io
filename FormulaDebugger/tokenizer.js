export default class Tokenizer {
    // Lightweight regex-based tokenizer for Salesforce formulas.
    // Order matters: multi-character operators must precede their prefixes
    // (&& before &, == before =, <= before <).
    static TOKEN_PATTERNS = [
        [/^\s+/, 'WHITESPACE'],
        // Invisible characters that ride along when formulas are copied from
        // web pages or documents (soft hyphen, zero-width spaces/joiners,
        // directional marks, word joiner, BOM) — treat as whitespace
        [/^[\u00AD\u200B-\u200F\u2060\uFEFF]+/, 'WHITESPACE'],
        [/^"[^"]*"/, 'DOUBLE_QUOTE_STRING'],
        // Curly ("smart") quotes from copy-pasted documents delimit strings
        // like their straight counterparts
        [/^[“”][^“”]*[“”]/, 'DOUBLE_QUOTE_STRING'],
        [/^(?:\d+(?:\.\d+)?|\.\d+)/, 'NUMBER'],
        [/^'[^']*'/, 'STRING'],
        [/^[‘’][^‘’]*[‘’]/, 'STRING'],
        [/^\/\/.*/, 'SINGLE_LINE_COMMENT'],
        [/^\/\*[\s\S]*?\*\//, 'MULTI_LINE_COMMENT'],
        [/^[+\-]/, 'ADDITIVE_OPERATOR'],
        [/^&&/, 'AND'],
        [/^&/, 'CONCAT'],
        [/^\|\|/, 'OR'],
        [/^\^/, 'EXPONENT'],
        [/^[*\/]/, 'MULTIPLICATIVE_OPERATOR'],
        [/^[()]/, 'PARENTHESIS'],
        [/^[{}]/, 'BRACES'],
        [/^,/, 'COMMA'],
        [/^==/, 'EQUAL'],
        [/^=/, 'EQUAL'],
        [/^!=/, 'NOT_EQUAL'],
        [/^<>/, 'NOT_EQUAL'],
        [/^<=/, 'LESS_THAN_OR_EQUAL'],
        [/^>=/, 'GREATER_THAN_OR_EQUAL'],
        [/^</, 'LESS_THAN'],
        [/^>/, 'GREATER_THAN'],
        [/^TRUE\b/i, 'BOOLEAN'],
        [/^FALSE\b/i, 'BOOLEAN'],
        [/^NULL\b/i, 'NULL'],
        // Fields may be dotted paths (Account.Industry) or globals ($User.FirstName)
        [/^[$a-zA-Z_]\w*(?:\.[$a-zA-Z_]\w*)*/, 'IDENTIFIER']
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
        // Include the code point: invisible or lookalike characters from
        // copy-paste would otherwise show as '' and be undiagnosable
        const ch = remainingPart[0];
        const codePoint = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
        throw new Error(`Unexpected character at position ${pos}: '${ch}' (${codePoint}). Near: '${expressionSnippet}'`);
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
