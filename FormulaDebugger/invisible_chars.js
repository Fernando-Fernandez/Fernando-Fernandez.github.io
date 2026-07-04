// Single source of truth for invisible/formatting characters that ride along
// when formulas are copied from web pages or documents. The tokenizer strips
// them before tokenizing, and the UI warns about them and offers a cleanup —
// all three must agree on the same set, or a character can be silently
// accepted here yet still rejected by Salesforce.

const INVISIBLE_CHAR_CLASS = '[\\u00AD\\u034F\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF]';

export const INVISIBLE_CHAR_NAMES = {
  '\u00AD': 'soft hyphen',
  '\u034F': 'combining grapheme joiner',
  '\u061C': 'Arabic letter mark',
  '\u200B': 'zero-width space',
  '\u200C': 'zero-width non-joiner',
  '\u200D': 'zero-width joiner',
  '\u200E': 'left-to-right mark',
  '\u200F': 'right-to-left mark',
  '\u202A': 'left-to-right embedding',
  '\u202B': 'right-to-left embedding',
  '\u202C': 'pop directional formatting',
  '\u202D': 'left-to-right override',
  '\u202E': 'right-to-left override',
  '\u2060': 'word joiner',
  '\u2061': 'function application',
  '\u2062': 'invisible times',
  '\u2063': 'invisible separator',
  '\u2064': 'invisible plus',
  '\u2066': 'left-to-right isolate',
  '\u2067': 'right-to-left isolate',
  '\u2068': 'first strong isolate',
  '\u2069': 'pop directional isolate',
  '\uFEFF': 'byte order mark',
};

// Fresh regex per call: a shared global regex carries lastIndex state
// between callers and produces skipped matches
export function invisibleCharRegex() {
  return new RegExp(INVISIBLE_CHAR_CLASS, 'g');
}

export function stripInvisibleChars(value) {
  return String(value ?? '').replace(invisibleCharRegex(), '');
}

export function invisibleCharName(ch) {
  return INVISIBLE_CHAR_NAMES[ch] || 'invisible formatting character';
}
