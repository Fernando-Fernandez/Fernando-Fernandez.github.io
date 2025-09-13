// Shared globals/constants used across Formula Debugger scripts
export const GETHOSTANDSESSION = "getHostSession";
export const TOOLING_API_VERSION = 'v57.0';

// Mutable env shared via ES modules
export const env = { host: undefined, sessionId: undefined };

export function setHostSession(h, s) {
  env.host = h;
  env.sessionId = s;
}
