import FormulaEngine from './formula_engine.js';

// CSS style constants
const STYLE_ERROR_BOX = 'color: red; padding: 10px; background: #ffe8e8; border: 1px solid #f44336; border-radius: 4px;';
const STYLE_CONTAINER = 'font-family: Arial, sans-serif;';
const STYLE_VARS_SECTION = 'margin-bottom: 15px;';
const STYLE_VARS_LIST = 'margin-top: 10px; display: grid; grid-template-columns: repeat(3, minmax(280px, 1fr)); gap: 8px 16px; align-items: start;';
const STYLE_FIELD_ROW = 'display: flex; align-items: center; gap: 8px;';
const STYLE_FIELD_LABEL = 'display: inline-block; width: 120px; font-weight: bold;';
const STYLE_FIELD_INPUT = 'flex: 1; padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px;';
const STYLE_TYPE_SELECT = 'padding: 4px 6px; border: 1px solid #ccc; border-radius: 3px;';
const STYLE_NOW_HELPER = 'font-size: 11px; color: #666; margin-top: 2px; margin-left: 120px;';
const STYLE_PRIMARY_BUTTON = 'padding: 8px 16px; background: #007cba; color: white; border: none; border-radius: 4px; cursor: pointer;';
const STYLE_SECONDARY_BUTTON = 'padding: 8px 16px; background: #555; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 8px;';
const STYLE_RESULT_BOX = 'margin: 10px 0; padding: 10px; background: #e8f5e8; border: 1px solid #4caf50; border-radius: 4px; display: none;';
const STYLE_STEPS_LIST = 'margin-top: 10px; overflow-x: auto; overflow-y: visible; max-width: 100%;';

// Tree styles for hierarchical horizontal layout (table-based)
const STYLE_TREE_TABLE = 'border-collapse: separate;';
const STYLE_TREE_CHILD_TABLE = 'border-collapse: separate;';
const STYLE_TREE_TD = 'vertical-align: top;';
const STYLE_TREE_CHILD_CONTAINER_TD = 'vertical-align: top; border-top: 1px solid #d0d7de; border-bottom: 1px solid #d0d7de; border-left: 1px solid #d0d7de;';
const STYLE_TREE_NODE = 'display: inline-block; padding: 8px 10px; border-radius: 6px; background: #f9f9f9; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; min-width: 220px; max-width: 320px; box-shadow: 0 1px 0 rgba(0,0,0,0.03);';
const STYLE_TREE_RESULT = 'margin-top: 4px; color: white; background-color: #007cba; font-weight: normal;';
// (Removed line styles; tables handle layout visually)

// Color constants
const COLOR_ERROR_BG = '#ffe8e8';
const COLOR_ERROR = '#f44336';
const COLOR_SUCCESS_BG = '#e8f5e8';
const COLOR_SUCCESS = '#4caf50';

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
        <div style="${STYLE_ERROR_BOX}">
          <strong>Formula Analysis Error:</strong><br>${error.message}
        </div>`;
    }
  }

  // Build a Mermaid diagram string for the AST
  static toMermaid(ast, { fenced = true, results = null } = {}) {
    const lines = ['graph LR'];
    let counter = 0;
    const newId = () => `n${++counter}`;

    // Build lookup from provided results
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
    const formulaTextarea = doc.getElementById('CalculatedFormula');
    return formulaTextarea ? (formulaTextarea.value || 'No formula content found.') : 'Formula editor not found.';
  }

  static displayDataStructure(ast, doc) {
    const debugOutput = doc.getElementById('debugOutput');
    if (!debugOutput) return;

    const variables = FormulaEngine.extractVariables(ast);
    const steps = FormulaEngine.extractCalculationSteps(ast);

    debugOutput.innerHTML = '';
    const container = doc.createElement('div');
    container.style.cssText = STYLE_CONTAINER;

    if (variables.length > 0) {
      const varsDiv = doc.createElement('div');
      varsDiv.style.cssText = STYLE_VARS_SECTION;
      varsDiv.innerHTML = '<strong>Field Values</strong>';

      const varsList = doc.createElement('div');
      varsList.style.cssText = STYLE_VARS_LIST;

      variables.forEach(variable => {
        const fieldDiv = doc.createElement('div');
        fieldDiv.style.cssText = STYLE_FIELD_ROW;

        const label = doc.createElement('span');
        label.textContent = `${variable}: `;
        label.style.cssText = STYLE_FIELD_LABEL;

        const input = doc.createElement('input');
        input.id = `var-${variable}`;
        input.style.cssText = STYLE_FIELD_INPUT;

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
          typeSel.style.cssText = STYLE_TYPE_SELECT;
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
          helperText.style.cssText = STYLE_NOW_HELPER;
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
      calculateBtn.style.cssText = STYLE_PRIMARY_BUTTON;
      calculateBtn.addEventListener('click', async () => await this.calculateAndDisplay(ast, doc));
      container.appendChild(calculateBtn);

      const mermaidBtn = doc.createElement('button');
      mermaidBtn.textContent = 'Open Diagram';
      mermaidBtn.type = 'button';
      mermaidBtn.style.cssText = STYLE_SECONDARY_BUTTON;
      mermaidBtn.addEventListener('click', () => this.openMermaidDiagram(ast));
      container.appendChild(mermaidBtn);

      const resultDiv = doc.createElement('div');
      resultDiv.id = 'calculationResult';
      resultDiv.style.cssText = STYLE_RESULT_BOX;
      container.appendChild(resultDiv);
    }

    if (steps.length > 0) {
      const stepsList = doc.createElement('div');
      stepsList.id = 'stepsList';
      stepsList.style.cssText = STYLE_STEPS_LIST;

      // Build hierarchical tree from AST (no results yet)
      const tree = this.buildAstTree(doc, ast, { includeResults: false });
      stepsList.appendChild(tree);

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

      try { FormulaEngine.annotateTypes(ast, typedVars, types); } catch (_) {}
      const comparisonErrors = FormulaEngine.collectComparisonTypeErrors(ast);
      const arithmeticErrors = FormulaEngine.collectArithmeticTypeErrors(ast);
      const typeErrors = [...comparisonErrors, ...arithmeticErrors];
      if (typeErrors.length > 0) {
        const items = typeErrors
          .map(e => `• ${e.expression} — ${e.leftType} ${e.operator} ${e.rightType}`)
          .join('<br>');
        resultDiv.innerHTML = `<strong>Type error:</strong><br>Operands must have compatible types.<br>${items}`;
        resultDiv.style.display = 'block';
        resultDiv.style.background = COLOR_ERROR_BG;
        resultDiv.style.borderColor = COLOR_ERROR;
        return;
      }

      const result = FormulaEngine.calculate(ast, typedVars);
      const displayResult = (
        result === null ? 'null' :
        FormulaEngine.isDate(result) ? result.toLocaleString() :
        (typeof result === 'number' && result % 1 !== 0 ? result.toFixed(6) : result)
      );
      resultDiv.innerHTML = `<strong>Result:</strong> ${displayResult}`;
      resultDiv.style.display = 'block';
      resultDiv.style.background = COLOR_SUCCESS_BG;
      resultDiv.style.borderColor = COLOR_SUCCESS;

      await this.updateStepsWithCalculation(ast, typedVars, doc, types);
    } catch (error) {
      resultDiv.innerHTML = `<strong>Error:</strong> ${error.message}`;
      resultDiv.style.display = 'block';
      resultDiv.style.background = COLOR_ERROR_BG;
      resultDiv.style.borderColor = COLOR_ERROR;
    }
  }

  static async updateStepsWithCalculation(ast, variables, doc, types = {}) {
    const stepsList = doc.getElementById('stepsList');
    if (!stepsList) return;

    try { FormulaEngine.annotateTypes(ast, variables, types); } catch(e) {}
    stepsList.innerHTML = '';

    // Rebuild hierarchical tree including computed results
    const tree = this.buildAstTree(doc, ast, { includeResults: true, variables });
    stepsList.appendChild(tree);

    // Reflect final result (root evaluation)
    const resultDiv = doc.getElementById('calculationResult');
    if (resultDiv) {
      let finalResult;
      try { finalResult = FormulaEngine.calculate(ast, variables); }
      catch (error) { finalResult = `Error: ${error.message}`; }
      const displayResult = (
        finalResult === null ? 'null' :
        FormulaEngine.isDate(finalResult) ? finalResult.toLocaleString() :
        (typeof finalResult === 'number' && finalResult % 1 !== 0 ? finalResult.toFixed(6) : finalResult)
      );
      resultDiv.innerHTML = `<strong>Result:</strong> ${displayResult}`;
      resultDiv.style.display = 'block';
      resultDiv.style.background = COLOR_SUCCESS_BG;
      resultDiv.style.borderColor = COLOR_SUCCESS;
    }
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

// Helper: Build a nested table/td tree following the AST hierarchy
// Options: { includeResults?: boolean, variables?: object }
FormulaUI.buildAstTree = function(doc, node, options = {}) {
  const { includeResults = false, variables = {} } = options;

  const makeNodeLabel = (n) => {
    const expr = FormulaEngine.rebuild(n);
    const t = (n && n.resultType) ? n.resultType : 'Unknown';
    let label = `${expr} -> ${t}`;
    if (includeResults) {
      let r;
      try { r = FormulaEngine.calculate(n, variables); }
      catch (e) { r = `Error: ${e.message}`; }
      const display = (
        r === null ? 'null' :
        FormulaEngine.isDate(r) ? r.toLocaleString() :
        (typeof r === 'number' && r % 1 !== 0 ? r.toFixed(6) : r)
      );
      label += `\n= ${display}`;
    }
    return label;
  };

  // Helper: determine if a node is just a literal value (not an expression)
  const isValueNode = (n) => !!n && n.type === 'Literal';

  // Create the node box element (expression, type, and optional result)
  const createNodeBox = (n) => {
    if (isValueNode(n)) return null; // Skip pure value nodes
    const box = doc.createElement('div');
    box.style.cssText = STYLE_TREE_NODE;
    const text = doc.createElement('div');
    text.textContent = `${FormulaEngine.rebuild(n)} -> ${(n && n.resultType) ? n.resultType : 'Unknown'}`;
    box.appendChild(text);
    if (includeResults) {
      let r;
      try { r = FormulaEngine.calculate(n, variables); } catch (e) { r = `Error: ${e.message}`; }
      const display = (
        r === null ? 'null' :
        FormulaEngine.isDate(r) ? r.toLocaleString() :
        (typeof r === 'number' && r % 1 !== 0 ? r.toFixed(6) : r)
      );
      const res = doc.createElement('span');
      res.style.cssText = STYLE_TREE_RESULT;
      res.textContent = `= ${display}`;
      box.appendChild(res);
    }
    return box;
  };

  // Build a children table where each child is a separate row (TR)
  // and each row has two columns: [child node][child's nested children table]
  const buildChildrenTable = (parentNode) => {
    let kids = [];
    if (parentNode && parentNode.type === 'Function') kids = parentNode.arguments || [];
    else if (parentNode && parentNode.type === 'Operator') kids = [parentNode.left, parentNode.right].filter(Boolean);
    // Exclude pure value nodes
    kids = kids.filter(k => !isValueNode(k));
    if (kids.length === 0) return null;

    const tbl = doc.createElement('table');
    tbl.style.cssText = STYLE_TREE_CHILD_TABLE;

    for (const k of kids) {
      const row = doc.createElement('tr');

      const nodeCell = doc.createElement('td');
      nodeCell.style.cssText = STYLE_TREE_TD;
      const kBox = createNodeBox(k);
      if (kBox) nodeCell.appendChild(kBox);

      const sub = buildChildrenTable(k);

      row.appendChild(nodeCell);
      if (sub) {
        const nestedCell = doc.createElement('td');
        nestedCell.style.cssText = STYLE_TREE_CHILD_CONTAINER_TD;
        nestedCell.appendChild(sub);
        row.appendChild(nestedCell);
      }
      tbl.appendChild(row);
    }

    return tbl;
  };

  // Root table with two columns: current node and its children table
  const createTableForNode = (n) => {
    const table = doc.createElement('table');
    table.style.cssText = STYLE_TREE_TABLE;

    const row = doc.createElement('tr');

    const nodeBox = createNodeBox(n);
    if (nodeBox) {
      const nodeTd = doc.createElement('td');
      nodeTd.style.cssText = STYLE_TREE_TD;
      nodeTd.appendChild(nodeBox);
      row.appendChild(nodeTd);
    }

    const childrenTable = buildChildrenTable(n);
    if (childrenTable) {
      const childrenTd = doc.createElement('td');
      childrenTd.style.cssText = STYLE_TREE_CHILD_CONTAINER_TD;
      childrenTd.appendChild(childrenTable);
      row.appendChild(childrenTd);
    }

    if (row.children.length === 0) {
      // Nothing to render for this node (likely a value-only leaf)
      return doc.createDocumentFragment();
    }
    table.appendChild(row);
    return table;
  };

  return createTableForNode(node);
};
