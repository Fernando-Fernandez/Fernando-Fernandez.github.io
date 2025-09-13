import FormulaEngine from './formula_engine.js';
import ToolingAPIHandler from './tooling_api_handler.js';
import { TOOLING_API_VERSION, env } from './globals.js';

export default class FormulaUI {
  // Entry point: parse the formula and render the UI
  static run(doc = (typeof window !== 'undefined' ? window.document : null)) {
    if (!doc) return;

    const formula = FormulaUI.extractFormulaContent(doc);
    const debugOutput = doc.getElementById('debugOutput');
    if (!debugOutput) {
      console.error('Debug output element not found.');
      return;
    }

    try {
      if (!formula || formula.trim() === '') {
        debugOutput.innerText = 'No formula to analyze';
        return;
      }
      const ast = FormulaEngine.parse(formula.trim());
      FormulaEngine.annotateTypes(ast, {}, {});
      FormulaUI.displayDataStructure(ast, doc);
    } catch (error) {
      debugOutput.innerHTML = `
        <div style="color: red; padding: 10px; background: #ffe8e8; border: 1px solid #f44336; border-radius: 4px;">
          <strong>Formula Analysis Error:</strong><br>${error.message}
        </div>`;
    }
  }

  // Build a Mermaid diagram string for the AST
  static toMermaid(ast, { fenced = true, results = null } = {}) {
    const lines = ['graph LR'];
    let counter = 0;
    const newId = () => `n${++counter}`;

    // Build lookup from provided results or last Apex run
    let resultsByExpr = null;
    let resultsIsMapLike = false;

    if (results) {
      if (Array.isArray(results)) {
        resultsByExpr = new Map();
        for (const item of results) {
          if (!item) continue;
          if (Array.isArray(item) && item.length >= 2) {
            resultsByExpr.set(String(item[0]), item[1]);
          } else if (item.expression !== undefined) {
            resultsByExpr.set(String(item.expression), item.result ?? item.value);
          }
        }
      } else if (results instanceof Map) {
        resultsIsMapLike = true;
      } else if (typeof results === 'object') {
        resultsByExpr = new Map(Object.entries(results));
      }
    }

    if (!results && FormulaUI.lastParsedResults && Array.isArray(FormulaUI.lastParsedResults.matches)) {
      try {
        const steps = FormulaEngine.extractCalculationSteps(ast);
        const indexToExpr = new Map();
        steps.forEach((s, i) => indexToExpr.set(i + 1, FormulaEngine.rebuild(s.node)));
        resultsByExpr = new Map();
        for (const m of FormulaUI.lastParsedResults.matches) {
          const idx = parseInt(m.stepIndex, 10);
          if (!Number.isNaN(idx) && indexToExpr.has(idx)) {
            const expr = indexToExpr.get(idx);
            resultsByExpr.set(expr, m.value);
          }
        }
        results = resultsByExpr;
        resultsIsMapLike = true;
      } catch (_) {
        // ignore
      }
    }

    const formatResult = (v) => {
      if (v === undefined) return undefined;
      if (v === null) return 'null';
      try {
        if (FormulaEngine && typeof FormulaEngine.isDate === 'function' && FormulaEngine.isDate(v)) {
          return v.toISOString();
        }
      } catch (_) {}
      if (typeof v === 'number' && v % 1 !== 0) return v.toFixed(6);
      return String(v);
    };

    const lookupResult = (node) => {
      if (!results) return undefined;
      const expr = FormulaEngine.rebuild(node);
      let v;
      if (resultsIsMapLike && typeof results.get === 'function') {
        v = results.get(node);
        if (v === undefined) v = results.get(expr);
      }
      if (v === undefined && resultsByExpr) {
        v = (typeof resultsByExpr.get === 'function') ? resultsByExpr.get(expr) : resultsByExpr[expr];
      }
      return v;
    };

    // Basic JS escaping for JSON fragments in labels
    const esc = (s) => String(s)
      .replace(/\\/g, '\\\\')
      .replace(/\"/g, '\\"')
      .replace(/\n/g, '\\n');

    // Render a readable label for a node; convert double quotes to single in expressions
    const renderLabel = (node) => {
      switch (node.type) {
        case 'Function': {
          const expr = FormulaEngine.rebuild(node);
          const exprDisp = String(expr).replace(/\"/g, '"').replace(/"/g, "'");
          const rv = formatResult(lookupResult(node));
          return rv !== undefined ? `${exprDisp} <br><br>= ${rv}` : `${exprDisp}`;
        }
        case 'Operator': {
          const expr = FormulaEngine.rebuild(node);
          const exprDisp = String(expr).replace(/\"/g, '"').replace(/"/g, "'");
          const rv = formatResult(lookupResult(node));
          return rv !== undefined ? `${exprDisp} <br><br>= ${rv}` : `${exprDisp}`;
        }
        case 'Literal':
          return esc(JSON.stringify(node.value));
        case 'Field':
          return esc(node.name);
        default:
          return esc(JSON.stringify(node));
      }
    };

    const walk = (node) => {
      if (!node) return null;
      const id = newId();
      lines.push(`${id}["${esc(renderLabel(node))}"]`);
      if (node.type === 'Function') {
        for (const a of (node.arguments || [])) {
          const c = walk(a);
          if (c) lines.push(`${id} --> ${c}`);
        }
      } else if (node.type === 'Operator') {
        const l = walk(node.left); if (l) lines.push(`${id} --> ${l}`);
        const r = walk(node.right); if (r) lines.push(`${id} --> ${r}`);
      }
      return id;
    };

    if (ast) walk(ast);
    const mermaid = lines.join('\n');
    const output = fenced ? `\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n` : mermaid;
    try { console.log(output); } catch (_) {}
    return mermaid;
  }

  static extractFormulaContent(doc) {
    const inFlow = (
      typeof window !== 'undefined' &&
      window.location &&
      window.location.href.includes('/builder_platform_interaction/flowBuilder.app')
    );

    let formulaTextarea;
    if (inFlow) {
      formulaTextarea = doc.querySelector('textarea[name="Formula"][id^="Formula-"]');
    } else {
      formulaTextarea = doc.getElementById('CalculatedFormula');
    }
    return formulaTextarea ? (formulaTextarea.value || 'No formula content found.') : 'Formula editor not found.';
  }

  static displayDataStructure(ast, doc) {
    const debugOutput = doc.getElementById('debugOutput');
    if (!debugOutput) return;

    const variables = FormulaEngine.extractVariables(ast);
    const steps = FormulaEngine.extractCalculationSteps(ast);

    debugOutput.innerHTML = '';
    const container = doc.createElement('div');
    container.style.cssText = 'font-family: Arial, sans-serif;';

    if (variables.length > 0) {
      const varsDiv = doc.createElement('div');
      varsDiv.style.cssText = 'margin-bottom: 15px;';
      varsDiv.innerHTML = '<strong>Field Values</strong>';

      const varsList = doc.createElement('div');
      varsList.style.cssText = 'margin-top: 10px; display: grid; grid-template-columns: repeat(3, minmax(280px, 1fr)); gap: 8px 16px; align-items: start;';

      variables.forEach(variable => {
        const fieldDiv = doc.createElement('div');
        fieldDiv.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const label = doc.createElement('span');
        label.textContent = `${variable}: `;
        label.style.cssText = 'display: inline-block; width: 120px; font-weight: bold;';

        const input = doc.createElement('input');
        input.id = `var-${variable}`;
        input.style.cssText = 'flex: 1; padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px;';

        if (variable === 'NOW()') {
          input.type = 'datetime-local';
          input.placeholder = 'Select date/time for testing';
          const now = new Date();
          const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
          input.value = localDateTime.toISOString().slice(0, 16);
        } else {
          input.type = 'text';
          input.placeholder = `Enter value for ${variable}`;
        }

        fieldDiv.appendChild(label);
        fieldDiv.appendChild(input);

        if (variable !== 'NOW()') {
          const typeSel = doc.createElement('select');
          typeSel.id = `type-${variable}`;
          typeSel.style.cssText = 'padding: 4px 6px; border: 1px solid #ccc; border-radius: 3px;';
          const opts = [
            { v: 'Auto', t: 'Auto' },
            { v: 'Text', t: 'Text' },
            { v: 'Number', t: 'Number' },
            { v: 'Boolean', t: 'Boolean' },
            { v: 'Date', t: 'Date' },
            { v: 'DateTime', t: 'DateTime' },
          ];
          for (const o of opts) {
            const op = doc.createElement('option');
            op.value = o.v; op.textContent = o.t;
            typeSel.appendChild(op);
          }
          fieldDiv.appendChild(typeSel);
        }

        if (variable === 'NOW()') {
          const helperText = doc.createElement('div');
          helperText.style.cssText = 'font-size: 11px; color: #666; margin-top: 2px; margin-left: 120px;';
          helperText.textContent = 'Leave empty to use current date/time';
          fieldDiv.appendChild(helperText);
        }

        varsList.appendChild(fieldDiv);
      });

      varsDiv.appendChild(varsList);
      container.appendChild(varsDiv);

      const calculateBtn = doc.createElement('button');
      calculateBtn.textContent = 'Calculate Formula';
      calculateBtn.type = 'button';
      calculateBtn.style.cssText = 'padding: 8px 16px; background: #007cba; color: white; border: none; border-radius: 4px; cursor: pointer;';
      calculateBtn.addEventListener('click', async () => await this.calculateAndDisplay(ast, doc));
      container.appendChild(calculateBtn);

      const mermaidBtn = doc.createElement('button');
      mermaidBtn.textContent = 'Open Diagram';
      mermaidBtn.type = 'button';
      mermaidBtn.style.cssText = 'padding: 8px 16px; background: #555; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 8px;';
      mermaidBtn.addEventListener('click', () => this.openMermaidDiagram(ast));
      container.appendChild(mermaidBtn);

      try {
        const canApex = (
          typeof chrome !== 'undefined' && chrome && chrome.runtime && env && env.host && env.sessionId
        );
        if (canApex) {
          const apexToggleWrap = doc.createElement('label');
          apexToggleWrap.style.cssText = 'display:inline-flex; align-items:center; gap:6px; margin-left:10px; font-size: 12px;';
          const apexToggle = doc.createElement('input');
          apexToggle.type = 'checkbox';
          apexToggle.id = 'use-apex-steps';
          apexToggle.title = 'Calculate each step via Anonymous Apex';
          const apexToggleText = doc.createElement('span');
          apexToggleText.textContent = 'Use Anonymous Apex for steps calculation';
          apexToggleWrap.appendChild(apexToggle);
          apexToggleWrap.appendChild(apexToggleText);
          container.appendChild(apexToggleWrap);
        }
      } catch (_) {}

      const resultDiv = doc.createElement('div');
      resultDiv.id = 'calculationResult';
      resultDiv.style.cssText = 'margin: 10px 0; padding: 10px; background: #e8f5e8; border: 1px solid #4caf50; border-radius: 4px; display: none;';
      container.appendChild(resultDiv);
    }

    if (steps.length > 0) {
      const stepsList = doc.createElement('div');
      stepsList.id = 'stepsList';
      stepsList.style.cssText = 'margin-top: 10px;';

      steps.forEach((step, index) => {
        const stepDiv = doc.createElement('div');
        stepDiv.style.cssText = 'margin: 5px 0; padding: 8px; background: #f9f9f9; border-left: 3px solid #007cba; font-family: monospace;';
        const t = (step.node && step.node.resultType) ? step.node.resultType : 'Unknown';
        stepDiv.textContent = `${index + 1}. ${step.expression}  ->  ${t}`;
        stepsList.appendChild(stepDiv);
      });

      container.appendChild(stepsList);
    }

    debugOutput.appendChild(container);
  }

  static openMermaidDiagram(ast) {
    if (!ast) return;
    try {
      const mermaid = FormulaUI.toMermaid(ast, { fenced: false });
      const toB64 = (str) => {
        try { return btoa(unescape(encodeURIComponent(str))); }
        catch (_) { return btoa(str); }
      };
      const encoded = toB64(mermaid);
      const url = `https://mermaid.ink/svg/${encoded}`;
      if (typeof window !== 'undefined' && window.open) {
        const w = window.open(url, '_blank');
        if (!w) console.log('Mermaid diagram URL:', url);
      } else {
        console.log('Mermaid diagram URL:', url);
      }
    } catch (e) {
      console.error('Unable to open Mermaid diagram:', e);
    }
  }

  static async calculateAndDisplay(ast, doc) {
    const resultDiv = doc.getElementById('calculationResult');
    if (!resultDiv) return;

    try {
      const { values, types } = this.getVariableValues(ast, doc);
      const typedVars = this.coerceVariables(values, types);
      const useApex = !!(doc.getElementById('use-apex-steps') && doc.getElementById('use-apex-steps').checked);

      try { FormulaEngine.annotateTypes(ast, typedVars, types); } catch (_) {}
      const typeErrors = FormulaEngine.collectComparisonTypeErrors(ast);
      if (typeErrors.length > 0) {
        const items = typeErrors
          .map(e => `• ${e.expression} — ${e.leftType} ${e.operator} ${e.rightType}`)
          .join('<br>');
        resultDiv.innerHTML = `<strong>Type error:</strong><br>Comparison operands must have the same type.<br>${items}`;
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#ffe8e8';
        resultDiv.style.borderColor = '#f44336';
        return;
      }

      if (!useApex) {
        const result = FormulaEngine.calculate(ast, typedVars);
        const displayResult = (
          result === null ? 'null' :
          FormulaEngine.isDate(result) ? result.toLocaleString() :
          (typeof result === 'number' && result % 1 !== 0 ? result.toFixed(6) : result)
        );
        resultDiv.innerHTML = `<strong>Result:</strong> ${displayResult}`;
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#e8f5e8';
        resultDiv.style.borderColor = '#4caf50';
      } else {
        resultDiv.innerHTML = `<strong>Result:</strong> Computing via Apex…`;
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#fff8e1';
        resultDiv.style.borderColor = '#ffa000';
      }

      await this.updateStepsWithCalculation(ast, typedVars, doc, types);
    } catch (error) {
      resultDiv.innerHTML = `<strong>Error:</strong> ${error.message}`;
      resultDiv.style.display = 'block';
      resultDiv.style.background = '#ffe8e8';
      resultDiv.style.borderColor = '#f44336';
    }
  }

  static async updateStepsWithCalculation(ast, variables, doc, types = {}) {
    const stepsList = doc.getElementById('stepsList');
    if (!stepsList) return;

    try { FormulaEngine.annotateTypes(ast, variables, types); } catch(e) {}
    const steps = FormulaEngine.extractCalculationSteps(ast);
    stepsList.innerHTML = '';

    const useApex = !!(doc.getElementById('use-apex-steps') && doc.getElementById('use-apex-steps').checked);
    let runId = null;
    if (useApex) runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const resultDiv = doc.getElementById('calculationResult');
    let lastResultComputed;

    for (const [index, step] of steps.entries()) {
      const stepDiv = doc.createElement('div');
      stepDiv.style.cssText = 'margin: 5px 0; padding: 8px; background: #f9f9f9; border-left: 3px solid #007cba;';

      const exprDiv = doc.createElement('div');
      exprDiv.style.cssText = 'font-family: monospace; font-weight: bold;';
      const t = (step.node && step.node.resultType) ? step.node.resultType : 'Unknown';
      exprDiv.textContent = `${index + 1}. ${step.expression}  ->  ${t}`;

      const resultSpan = doc.createElement('div');
      resultSpan.style.cssText = 'font-family: monospace; color: #007cba; margin-top: 4px;';

      if (!useApex) {
        let result;
        try { result = FormulaEngine.calculate(step.node, variables); }
        catch (error) { result = `Error: ${error.message}`; }

        const displayResult = (
          result === null ? 'null' :
          FormulaEngine.isDate(result) ? result.toLocaleString() :
          (typeof result === 'number' && result % 1 !== 0 ? result.toFixed(6) : result)
        );
        resultSpan.textContent = `= ${displayResult}`;
        lastResultComputed = displayResult;
      } else {
        const idx = index + 1;
        resultSpan.id = `step-result-${runId}-${idx}`;
        resultSpan.textContent = '= …';
      }

      stepDiv.appendChild(exprDiv);
      stepDiv.appendChild(resultSpan);
      stepsList.appendChild(stepDiv);
    }

    if (useApex) {
      try {
        const anonymousApex = this.buildAnonymousApexForSteps(steps, ast, doc, runId, types);
        try {
          const handler = new ToolingAPIHandler(env.host, env.sessionId, TOOLING_API_VERSION);
          const ok = await handler.executeAnonymous(anonymousApex, runId, doc);
          if (handler && handler.lastParsedResults) {
            FormulaUI.lastParsedResults = handler.lastParsedResults;
            FormulaUI.lastRunId = handler.lastRunId;
          }
          if (ok && resultDiv && handler.lastParsedResults && Array.isArray(handler.lastParsedResults.matches)) {
            const matches = handler.lastParsedResults.matches;
            if (matches.length > 0) {
              const last = matches[matches.length - 1];
              resultDiv.innerHTML = `<strong>Result:</strong> ${last.value}`;
              resultDiv.style.display = 'block';
              resultDiv.style.background = '#4caf50';
              resultDiv.style.borderColor = '#4caf50';
            }
          }
          return ok;
        } catch (err) {
          console.error('ToolingAPIHandler error:', err);
          return null;
        }
      } catch (e) {
        console.error('Failed to run batched Apex for steps:', e);
      }
    } else {
      if (resultDiv && lastResultComputed !== undefined) {
        resultDiv.innerHTML = `<strong>Result:</strong> ${lastResultComputed}`;
        resultDiv.style.display = 'block';
        resultDiv.style.background = '#4caf50';
        resultDiv.style.borderColor = '#4caf50';
      }
    }
  }

  static buildAnonymousApexForSteps(steps, astRoot, doc, runId, types = {}) {
    const apexEscape = (s) => (s || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n');

    const inferSObjectFromUrl = () => {
      try {
        const href = window.location.href || '';
        const pathMatch = href.match(/ObjectManager\/([A-Za-z0-9_]+)\/Fields/i);
        if (pathMatch && pathMatch[1]) return pathMatch[1];
        const url = new URL(href);
        const params = url.searchParams;
        const candidates = ['type','ent','entity','entityname','sobject','sobjecttype'];
        for (const key of candidates) {
          const v = params.get(key);
          if (v && /^[A-Za-z0-9_]+$/.test(v)) return v;
        }
      } catch (_) {}
      return 'Account';
    };

    const typeMap = {
      Number: 'Decimal',
      Boolean: 'Boolean',
      Text: 'String',
      Date: 'Date',
      DateTime: 'DateTime'
    };

    const { values, types: selectedTypes } = this.getVariableValues(astRoot, doc);
    const varTypes = Object.assign({}, selectedTypes || {}, types || {});
    const typedValues = this.coerceVariables(values, varTypes);
    const variables = FormulaEngine.extractVariables(astRoot);
    const idPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

    const escapeApexString = (str) => String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n');

    const toApexLiteral = (raw, typeHint) => {
      if (raw === null || raw === undefined) return null;
      if (typeHint === 'Boolean') return String(Boolean(raw)).toLowerCase();
      if (typeHint === 'Number') {
        const n = Number(raw);
        if (isNaN(n) || !isFinite(n)) return null;
        return String(n);
      }
      if (typeHint === 'Date' || typeHint === 'DateTime') {
        const d = FormulaEngine.toDate(raw);
        if (!d) return null;
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        if (typeHint === 'Date') {
          return `Date.newInstance(${y}, ${m}, ${day})`;
        } else {
          const hh = d.getUTCHours();
          const mm = d.getUTCMinutes();
          const ss = d.getUTCSeconds();
          return `DateTime.newInstanceGMT(${y}, ${m}, ${day}, ${hh}, ${mm}, ${ss})`;
        }
      }
      const s = String(raw);
      return `'${escapeApexString(s)}'`;
    };

    const assignments = variables
      .filter(v => v !== 'NOW()' && idPattern.test(v))
      .map(v => ({ name: v, expr: toApexLiteral(typedValues[v], varTypes[v] || 'Auto') }))
      .filter(({ expr }) => expr !== null)
      .map(({ name, expr }) => `${name} = ${expr}`);

    const sobjectName = inferSObjectFromUrl();

    const lines = [];
    lines.push('FormulaEval.FormulaBuilder builder = Formula.builder();');
    lines.push('FormulaEval.FormulaInstance ff;');

    if (assignments.length > 0) {
      lines.push(`${sobjectName} obj = new ${sobjectName}(${assignments.join(', ')});`);
    } else {
      lines.push(`${sobjectName} obj = new ${sobjectName}();`);
    }

    for (let i = 0; i < steps.length; i++) {
      const node = steps[i].node;
      const expr = apexEscape(FormulaEngine.rebuild(node));
      const rt = typeMap[node.resultType] || 'Decimal';
      lines.push('ff = builder');
      lines.push(`    .withFormula('${expr}')`);
      lines.push(`    .withType(${sobjectName}.class)`);
      lines.push(`    .withReturnType(FormulaEval.FormulaReturnType.${rt})`);
      lines.push('    .build();');
      lines.push(`System.debug('SFDBG|${runId}|${i+1}|' + String.valueOf(ff.evaluate(obj)));`);
    }

    return lines.join('\n');
  }

  static getVariableValues(ast, doc) {
    const variables = FormulaEngine.extractVariables(ast);
    const values = {};
    const types = {};
    variables.forEach(variable => {
      const input = doc.getElementById(`var-${variable}`);
      values[variable] = input ? (input.value || '') : '';
      const typeSel = doc.getElementById(`type-${variable}`);
      const t = typeSel ? typeSel.value : (variable === 'NOW()' ? 'DateTime' : 'Auto');
      types[variable] = t;
    });
    return { values, types };
  }

  static coerceVariables(values, types) {
    const out = {};
    for (const [name, raw] of Object.entries(values || {})) {
      const t = (types && types[name]) || 'Auto';
      if (name === 'NOW()') {
        out[name] = raw; // special handling occurs in FormulaEngine
        continue;
      }
      switch (t) {
        case 'Text':
          out[name] = String(raw);
          break;
        case 'Number': {
          const n = Number(String(raw).trim());
          out[name] = (isNaN(n) || !isFinite(n)) ? 0 : n;
          break;
        }
        case 'Boolean': {
          const s = String(raw).trim().toLowerCase();
          out[name] = (s === 'true' || s === '1' || s === 'yes');
          break;
        }
        case 'Date':
        case 'DateTime': {
          const d = FormulaEngine.toDate(raw);
          out[name] = d ? d : '';
          break;
        }
        case 'Auto':
        default:
          out[name] = raw;
      }
    }
    return out;
  }
}

