// Minimal glue to run the Formula UI on this standalone page (ES module)
import FormulaUI from './formula_ui.js';
import FormulaEngine from './formula_engine.js';

(function () {
  function restoreSample() {
    try {
      const saved = localStorage.getItem('fd.formula');
      if (saved) {
        document.getElementById('CalculatedFormula').value = saved;
        return;
      }
    } catch (_) {}
    // Provide a default sample for first-time use
    document.getElementById('CalculatedFormula').value = "IF((Amount + 50) >= 100, 'OK', 'NO')";
  }

  function saveSample() {
    try {
      const v = document.getElementById('CalculatedFormula').value || '';
      localStorage.setItem('fd.formula', v);
    } catch (_) {}
  }

  function analyze() {
    // Clear previous output
    const out = document.getElementById('debugOutput');
    out.innerHTML = '';
    // Run the existing UI logic
    FormulaUI.run(document);
    saveSample();
  }

  function openMermaid() {
    try {
      const raw = document.getElementById('CalculatedFormula').value || '';
      const ast = FormulaEngine.parse(raw);
      FormulaUI.openMermaidDiagram(ast);
    } catch (e) {
      alert('Unable to generate Mermaid diagram: ' + (e && e.message ? e.message : e));
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    restoreSample();
    document.getElementById('analyzeBtn').addEventListener('click', analyze);
    document.getElementById('mermaidBtn').addEventListener('click', openMermaid);
  });
})();
