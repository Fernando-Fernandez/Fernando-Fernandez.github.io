export const PENDING_FUNCTIONS = [
  'CURRENCYRATE',
  'GETRECORDIDS',
  'GETSESSIONID',
  'IMAGEPROXYURL',
  'INCLUDE',
  'ISCHANGED',
  'ISCLONE',
  'ISNEW',
  'JUNCTIONIDLIST',
  'LINKTO',
  'PARENTGROUPVAL',
  'PREDICT',
  'PREVGROUPVAL',
  'PRIORVALUE',
  'REQUIRESCRIPT',
  'URLFOR',
  'VLOOKUP',
];

const PENDING_FUNCTION_SET = new Set(PENDING_FUNCTIONS);

export function isPendingFunction(name = '') {
  if (!name) return false;
  return PENDING_FUNCTION_SET.has(String(name).toUpperCase());
}

export function pendingFunctionVariableName(name = '') {
  return String(name || '').toUpperCase();
}

export function pendingFunctionDefaultValue(name = '') {
  return `${pendingFunctionVariableName(name)}_VALUE`;
}

export function pendingFunctionVariableValue(name, variables = {}) {
  const varName = pendingFunctionVariableName(name);
  if (variables && typeof variables.get === 'function' && variables.has(varName)) {
    return variables.get(varName);
  }
  if (variables && Object.prototype.hasOwnProperty.call(variables, varName)) {
    return variables[varName];
  }
  return pendingFunctionDefaultValue(name);
}
