import { TOOLING_API_VERSION } from './globals.js';

export default class ToolingAPIHandler {
  constructor(host, sessionId, apiVersion = TOOLING_API_VERSION) {
    this.host = host;
    this.sessionId = sessionId;
    this.apiVersion = apiVersion;
    this.lastParsedResults = null;
    this.lastRunId = null;
  }

  // Build a fully qualified endpoint + request with auth headers
  buildRequest(suffix, { method = 'GET', json = null } = {}) {
    const base = `https://${this.host}/services/data/${this.apiVersion}`;
    const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
    const endpoint = `${base}${normalized}`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.sessionId}`
    };

    const request = { method, headers };
    if (json !== null && json !== undefined) {
      request.body = JSON.stringify(json, null, 2);
    }
    return { endpoint, request };
  }

  // Encode Apex for inclusion in a GET querystring
  encodeAnonymous(anonymousApex) {
    return encodeURI(anonymousApex)
      .replaceAll('(', '%28')
      .replaceAll(')', '%29')
      .replaceAll(';', '%3B')
      .replaceAll('+', '%2B');
  }

  // Execute Anonymous Apex and fetch the correlated Apex log
  async executeAnonymous(anonymousApex, runId = null, doc = null) {
    try {
      await this.ensureActiveTraceFlag();
    } catch (e) {
      console.warn('Could not ensure TraceFlag:', e);
    }

    const { endpoint, request } = this.buildRequest(
      `/tooling/executeAnonymous/?anonymousBody=${this.encodeAnonymous(anonymousApex)}`
    );

    try {
      const response = await fetch(endpoint, request);
      const data = await response.json();

      if (Array.isArray(data) && data[0].errorCode) {
        console.error('Could not execute Anonymous Apex:', data[0].message);
        return null;
      }
      if (!data.success) {
        console.error('Apex execution failed:', data.compileProblem);
        console.error('Apex execution stack:', data.exceptionStackTrace);
        console.error('Apex execution exception:', data.exceptionMessage);
        return null;
      }

      await this.sleep(750);
      return this.retrieveDebugLogId(runId, doc);
    } catch (err) {
      console.error('Network or parsing error:', err);
    }
    return null;
  }

  // Ensure a recent TraceFlag exists for the current user
  async ensureActiveTraceFlag() {
    const userId = await this.getCurrentUserId();
    if (!userId) return false;

    const now = new Date();
    const q = encodeURIComponent(
      `SELECT Id, StartDate, ExpirationDate, DebugLevelId
       FROM TraceFlag
       WHERE TracedEntityId='${userId}'
       ORDER BY ExpirationDate DESC`
    );
    const { endpoint: tfEndpoint, request: tfRequest } = this.buildRequest(`/tooling/query/?q=${q}`);

    try {
      const resp = await fetch(tfEndpoint, tfRequest);
      const data = await resp.json();
      if (data && data.records && data.records.length) {
        const active = data.records.find(r => {
          const start = r.StartDate ? new Date(r.StartDate) : null;
          const exp = r.ExpirationDate ? new Date(r.ExpirationDate) : null;
          return (!start || start <= now) && exp && exp > now;
        });
        if (active) return true;
      }
    } catch (e) {
      console.warn('TraceFlag query failed', e);
    }

    const debugLevelId = await this.ensureDebugLevel();
    if (!debugLevelId) return false;

    const start = new Date();
    const exp = new Date(start.getTime() + 5 * 60 * 1000);
    const body = {
      TracedEntityId: userId,
      DebugLevelId: debugLevelId,
      LogType: 'USER_DEBUG',
      StartDate: start.toISOString(),
      ExpirationDate: exp.toISOString()
    };

    const { endpoint: createEndpoint, request: createRequest } = this.buildRequest(
      '/tooling/sobjects/TraceFlag',
      { method: 'POST', json: body }
    );

    try {
      const createResp = await fetch(createEndpoint, createRequest);
      const res = await createResp.json();
      if (res && res.success) return true;
    } catch (e) {
      console.warn('TraceFlag create failed', e);
    }
    return false;
  }

  // Ensure a DebugLevel exists (returns Id)
  async ensureDebugLevel() {
    const q = encodeURIComponent(
      `SELECT Id FROM DebugLevel WHERE DeveloperName = 'FD_Debug'`
    );
    const { endpoint: qEndpoint, request: qRequest } = this.buildRequest(`/tooling/query/?q=${q}`);

    try {
      const resp = await fetch(qEndpoint, qRequest);
      const data = await resp.json();
      if (data && data.records && data.records.length) return data.records[0].Id;
    } catch (e) {
      console.warn('DebugLevel query failed', e);
    }

    const body = {
      DeveloperName: 'FD_Debug',
      MasterLabel: 'FD_Debug',
      ApexCode: 'FINEST',
      ApexProfiling: 'INFO',
      Callout: 'INFO',
      Database: 'INFO',
      System: 'INFO',
      Validation: 'INFO',
      Visualforce: 'INFO',
      Workflow: 'INFO'
    };

    const { endpoint: cEndpoint, request: cRequest } = this.buildRequest(
      '/tooling/sobjects/DebugLevel',
      { method: 'POST', json: body }
    );

    try {
      const resp = await fetch(cEndpoint, cRequest);
      const data = await resp.json();
      if (data && data.id) return data.id;
    } catch (e) {
      console.warn('DebugLevel create failed', e);
    }
    return null;
  }

  // Fetch current user id (Tooling API query)
  async getCurrentUserId() {
    const { endpoint, request } = this.buildRequest(
      '/tooling/query/?q=SELECT Id FROM User WHERE Id = :UserInfo.getUserId()'
    );
    try {
      const resp = await fetch(endpoint, request);
      const data = await resp.json();
      if (data && data.id) return data.id;
    } catch (e) {
      console.warn('Could not get current user id', e);
    }
    return null;
  }

  // Query latest ApexLog and fetch its body
  async retrieveDebugLogId(runId = null, doc = null) {
    const { endpoint, request } = this.buildRequest(
      '/tooling/query/?q=SELECT Id FROM ApexLog WHERE LogLength > 10000 ORDER BY StartTime DESC LIMIT 1'
    );
    try {
      const response = await fetch(endpoint, request);
      const data = await response.json();
      if (Array.isArray(data) && data[0].errorCode) {
        console.error('Could not find Apex Log:', data[0].message);
        return null;
      }
      if (!data.records || data.records.length === 0) {
        console.error('No Apex logs found');
        return null;
      }
      return this.retrieveDebugLogBody(data.records[0].Id, runId, doc);
    } catch (err) {
      console.error('Network or parsing error:', err);
    }
    return null;
  }

  async retrieveDebugLogBody(apexLogId, runId = null, doc = null) {
    const { endpoint, request } = this.buildRequest(
      `/tooling/sobjects/ApexLog/${apexLogId}/Body`
    );
    try {
      const response = await fetch(endpoint, request);
      const apexLog = await response.text();
      const parsed = this.parseApexLog(apexLog, runId);
      this.lastParsedResults = parsed;
      this.lastRunId = runId;
      const displayed = this.displayParsedResults(parsed, doc);
      if (displayed) return true;
      return parsed.fallback;
    } catch (err) {
      console.error('Network or parsing error:', err);
    }
    return null;
  }

  // Parse SFDBG markers out of a raw Apex log string
  parseApexLog(apexLog, runId = null) {
    const logLines = apexLog.split('\n');
    const pipe = '&#124;';
    const marker = 'SFDBG' + pipe;
    const matches = [];
    let fallback = null;

    for (const line of logLines) {
      if (!line.includes('USER_DEBUG')) continue;

      // Capture first USER_DEBUG as fallback
      if (fallback === null) {
        const m = line.match(/^.+?\|DEBUG\|(.*)/);
        if (m) fallback = m[1];
      }

      if (!line.includes(marker)) continue;

      const msgMatch = line.match(/\|DEBUG\|(.*)$/);
      const msg = msgMatch ? msgMatch[1] : '';
      const idx = msg.indexOf(marker);
      if (idx < 0) continue;

      const payload = msg.substring(idx + marker.length);
      const parts = payload.split(pipe);
      const rid = parts[0];
      const stepIndex = parts[1];
      const value = parts.slice(2).join(pipe);
      if (!runId || rid === runId) {
        matches.push({ rid, stepIndex, value });
      }
    }

    return { matches, fallback };
  }

  // Small sleep helper
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Push parsed values into the DOM if elements exist
  displayParsedResults(parsed, doc) {
    const ctxDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!ctxDoc || !parsed || !parsed.matches) return false;

    let any = false;
    for (const { rid, stepIndex, value } of parsed.matches) {
      const elId = `step-result-${rid}-${stepIndex}`;
      const el = ctxDoc.getElementById(elId);
      if (el) {
        el.textContent = `= ${value}`;
        any = true;
      }
    }
    return any;
  }
}
