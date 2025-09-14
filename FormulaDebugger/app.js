// Minimal glue to run the Formula UI on this standalone page (ES module)
import FormulaUI from './formula_ui.js';
import FormulaEngine from './formula_engine.js';

(function () {
  function getQueryParams() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (_) {
      return new URLSearchParams('');
    }
  }

  function restoreSample() {
    try {
      const params = getQueryParams();
      // Accept either `formula` or short `f`
      const fromUrl = params.get('formula') ?? params.get('f');
      if (fromUrl && fromUrl.trim()) {
        document.getElementById('CalculatedFormula').value = fromUrl;
        return { from: 'url', auto: params.get('run') === '1' || params.get('auto') === '1' || params.get('autoplay') === '1' };
      }

      const saved = localStorage.getItem('fd.formula');
      if (saved && saved.trim()) {
        document.getElementById('CalculatedFormula').value = saved;
        return { from: 'storage' };
      }
    } catch (_) {}
    // Provide a default sample for first-time use
    document.getElementById('CalculatedFormula').value = "IF((Amount + 50) >= 100, 'OK', 'NO')";
    return { from: 'default' };
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
    const restored = restoreSample();
    document.getElementById('analyzeBtn').addEventListener('click', analyze);
    document.getElementById('mermaidBtn').addEventListener('click', openMermaid);
    // If formula came from URL and auto is requested, run immediately
    if (restored && restored.from === 'url' && restored.auto) {
      analyze();
    }
  });
})();
