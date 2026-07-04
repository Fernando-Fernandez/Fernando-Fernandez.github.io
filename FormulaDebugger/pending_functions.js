// Functions that need org/record context or Visualforce and cannot be
// simulated client-side. The UI renders each occurrence as a stand-in input:
// the entered value becomes the function's return value during testing.
//
// Still to validate against a real org:
// - TIMENOW needs to return a time instead of a datetime
// - ROUND/CEILING/FLOOR/MCEILING/MFLOOR were aligned to documented Salesforce
//   semantics (half away from zero; CEILING away from zero when negative;
//   FLOOR toward zero; MCEILING/MFLOOR single-argument) - spot-check in an org
// - URLENCODE encodes spaces as + (Java URLEncoder style); verify edge characters
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
