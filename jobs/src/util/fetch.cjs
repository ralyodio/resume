const { ProxyAgent } = require('undici');

const DEFAULT_TIMEOUT_MS = 15000;
let cachedProxyUrl = null;
let cachedProxyDispatcher = null;

function redactUrl(url) {
  const s = String(url || '');
  try {
    const u = new URL(s);
    if (u.searchParams.has('api_key')) u.searchParams.set('api_key', '[REDACTED]');
    return u.toString();
  } catch {
    return s.replace(/([?&]api_key=)[^&\s]+/gi, '$1[REDACTED]');
  }
}

function currentProxyUrl() {
  return process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
}

function getProxyDispatcher() {
  const proxyUrl = currentProxyUrl();
  if (!proxyUrl) return null;
  if (cachedProxyDispatcher && cachedProxyUrl === proxyUrl) return cachedProxyDispatcher;
  if (cachedProxyDispatcher && typeof cachedProxyDispatcher.close === 'function') {
    cachedProxyDispatcher.close().catch(() => {});
  }
  cachedProxyUrl = proxyUrl;
  cachedProxyDispatcher = new ProxyAgent(proxyUrl);
  return cachedProxyDispatcher;
}

function withTimeout(url, opts={}) {
  const { timeoutMs=DEFAULT_TIMEOUT_MS, headers, signal, dispatcher, noProxy=false, ...rest } = opts;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(new Error(`Fetch timed out after ${timeoutMs}ms: ${redactUrl(url)}`)), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort',()=>controller.abort(signal.reason),{once:true});
  }
  const proxyDispatcher = noProxy ? null : (dispatcher || getProxyDispatcher());
  return { request: { ...rest, ...(proxyDispatcher ? {dispatcher: proxyDispatcher} : {}), headers, signal: controller.signal }, done: () => clearTimeout(timer) };
}

async function fetchText(url, opts={}) {
  const t=withTimeout(url, opts);
  try {
    const res = await fetch(url, { ...t.request, headers: { 'user-agent':'HermesRemoteJobs/0.1 (+review-only)', accept:'text/html,application/json,*/*', ...(opts.headers||{}) } });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}: ${redactUrl(url)}`);
    return await res.text();
  } catch (err) {
    if (err && err.name==='AbortError') throw new Error(`Fetch timed out after ${opts.timeoutMs||DEFAULT_TIMEOUT_MS}ms: ${redactUrl(url)}`);
    throw err;
  } finally {
    t.done();
  }
}

async function fetchJson(url, opts={}) {
  const t=withTimeout(url, opts);
  try {
    const res = await fetch(url, { ...t.request, headers: { 'user-agent':'HermesRemoteJobs/0.1 (+review-only)', accept:'application/json,*/*', ...(opts.headers||{}) } });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}: ${redactUrl(url)}`);
    return await res.json();
  } catch (err) {
    if (err && err.name==='AbortError') throw new Error(`Fetch timed out after ${opts.timeoutMs||DEFAULT_TIMEOUT_MS}ms: ${redactUrl(url)}`);
    throw err;
  } finally {
    t.done();
  }
}

module.exports = { fetchText, fetchJson, redactUrl, DEFAULT_TIMEOUT_MS, getProxyDispatcher };
