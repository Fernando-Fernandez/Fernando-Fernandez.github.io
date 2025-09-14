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

  function buildShareUrl(formula, { autoRun = true } = {}) {
    const url = new URL(window.location.href);
    // Normalize to `formula` param and drop `f` to avoid duplicates
    url.searchParams.delete('f');
    url.searchParams.set('formula', formula || '');
    if (autoRun) url.searchParams.set('run', '1'); else url.searchParams.delete('run');
    return url.toString();
  }

  async function copyShareUrl() {
    const btn = document.getElementById('copyUrlBtn');
    const formula = document.getElementById('CalculatedFormula').value || '';
    const share = buildShareUrl(formula, { autoRun: true });
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(share);
      } else {
        // Fallback: temporary textarea
        const ta = document.createElement('textarea');
        ta.value = share;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = original), 1200);
    } catch (e) {
      alert('Could not copy link: ' + (e && e.message ? e.message : e));
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    const restored = restoreSample();
    document.getElementById('analyzeBtn').addEventListener('click', analyze);
    document.getElementById('mermaidBtn').addEventListener('click', openMermaid);
    document.getElementById('copyUrlBtn').addEventListener('click', copyShareUrl);
    // If formula came from URL and auto is requested, run immediately
    if (restored && restored.from === 'url' && restored.auto) {
      analyze();
    }
  });
})();
