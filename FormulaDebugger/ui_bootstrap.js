// UIBootstrap
//
// Injects the Formula Debugger UI into Salesforce formula editors and Flow Builder.
// Wires the Run button to trigger FormulaUI and (in extension context) fetches host/session.

import FormulaUI from './formula_ui.js';
import { GETHOSTANDSESSION, env } from './globals.js';

export default class UIBootstrap {
  constructor({
    doc = (typeof window !== 'undefined' ? window.document : null),
    win = (typeof window !== 'undefined' ? window : null),
    chromeRuntime = (typeof chrome !== 'undefined' ? chrome.runtime : null),
    onRunDebug = null
  } = {}) {
    this.doc = doc;
    this.win = win;
    this.chromeRuntime = chromeRuntime;
    this.onRunDebug = onRunDebug || (() => FormulaUI.run(this.doc));
    this._mounted = false;
  }

  // Entry point — waits for the editor element and injects the UI once
  init() {
    if (!this.doc || !this.win) return;

    if (this.locationMatchesFormulaEditor()) {
      if (this.win === this.win.top) {
        this.waitForIframeAndElement();
      } else {
        this.waitForElement('CalculatedFormula', () => this.injectUI());
      }
      return;
    }

    // Flow Builder context: heuristically watch for a likely formula textarea
    if (this.locationMatchesFlowEditor()) {
      const selectors = [
        '#CalculatedFormula',
        'textarea[name="CalculatedFormula"]',
        'textarea[aria-label*="formula" i]',
        'textarea[placeholder*="formula" i]'
      ];
      this.waitForAnySelector(selectors, (el) => this.injectUI(el));
      return;
    }
  }

  // URL looks like standard formula editor
  locationMatchesFormulaEditor() {
    try {
      return (
        this.win &&
        this.win.location &&
        this.win.location.href.includes('/e?')
      );
    } catch (_) {
      return false;
    }
  }

  // URL looks like Flow Builder
  locationMatchesFlowEditor() {
    try {
      const href = (this.win && this.win.location) ? this.win.location.href : '';
      return href.includes('/builder_platform_interaction/flowBuilder.app');
    } catch (_) {
      return false;
    }
  }

  // Observe until element with a given id appears, then callback
  waitForElement(elementId, callback) {
    const element = this.doc.getElementById(elementId);
    if (element) { callback(); return; }

    const observer = new MutationObserver((mutations, obs) => {
      const el = this.doc.getElementById(elementId);
      if (el) { obs.disconnect(); callback(); }
    });
    observer.observe(this.doc, {
      childList: true,
      subtree: true
    });
  }

  // Wait until any selector matches; pass matched element to callback
  waitForAnySelector(selectors, callback) {
    const tryFind = () => {
      for (const sel of selectors) {
        try {
          const el = this.doc.querySelector(sel);
          if (el) return el;
        } catch (_) {
          // ignore invalid selectors
        }
      }
      return null;
    };

    const found = tryFind();
    if (found) { callback(found); return; }

    const observer = new MutationObserver((mutations, obs) => {
      const el = tryFind();
      if (el) { obs.disconnect(); callback(el); }
    });
    observer.observe(this.doc, {
      childList: true,
      subtree: true
    });
  }

  // Polls for the formula textarea from the top window (avoid cross-origin iframes)
  waitForIframeAndElement() {
    const checkForElement = () => {
      const element = this.doc.getElementById('CalculatedFormula');
      if (element) { this.injectUI(); return; }
      setTimeout(checkForElement, 500);
    };
    checkForElement();
  }

  // Ask extension background for current org host + session id
  async fetchHostAndSession() {
    if (!this.chromeRuntime) return;
    return new Promise(resolve => {
      const getHostMessage = {
        message: GETHOSTANDSESSION,
        url: (this.win ? this.win.location.href : '')
      };
      this.chromeRuntime.sendMessage(getHostMessage, (resultData) => {
        env.host = resultData && resultData.domain;
        env.sessionId = resultData && resultData.session;
        resolve({
          host: env.host,
          sessionId: env.sessionId
        });
      });
    });
  }

  // Inject the Formula Debugger controls next to the formula textarea
  injectUI(targetEl = null) {
    if (this._mounted) return;
    const formulaTextarea = targetEl || this.doc.getElementById('CalculatedFormula');
    if (!formulaTextarea) return;
    if (this.doc.getElementById('formulaDebugger')) return;

    const debuggerDiv = this.doc.createElement('div');
    debuggerDiv.id = 'formulaDebugger';
    debuggerDiv.style.cssText = [
      'margin-top: 10px',
      'padding: 10px',
      'border: 1px solid #ccc',
      'background: #f9f9f9',
      'font-family: Arial, sans-serif'
    ].join('; ');
    debuggerDiv.innerHTML = `
      <button id="runDebug" type="button" style="padding: 5px 10px;">Run Formula Debugger</button>
      <div id="debugOutput">Debug output will appear here once implemented.</div>
    `;
    formulaTextarea.parentNode.insertBefore(debuggerDiv, formulaTextarea.nextSibling);

    const btn = this.doc.getElementById('runDebug');
    if (btn) {
      btn.addEventListener('click', async () => {
        await this.fetchHostAndSession();
        this.onRunDebug();
      });
    }
    this._mounted = true;
  }
}
