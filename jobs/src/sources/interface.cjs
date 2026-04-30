function assertSourceAdapter(adapter){
  if (!adapter || typeof adapter !== 'object') throw new Error('Source adapter must be an object');
  if (!adapter.source || typeof adapter.source !== 'object') throw new Error('Source adapter missing source metadata');
  for (const f of ['id','name']) if (!adapter.source[f]) throw new Error(`Source adapter missing source.${f}`);
  for (const f of ['supportsRemoteFilter','supportsNativeApply','supportsExternalApply']) if (typeof adapter.source[f] !== 'boolean') throw new Error(`Source adapter source.${f} must be boolean`);
  for (const f of ['searchJobs','getJobDetails','getApplicationMode']) if (typeof adapter[f] !== 'function') throw new Error(`Source adapter missing ${f}()`);
  if (typeof adapter.applyToJob !== 'function') throw new Error('Source adapter missing applyToJob(); return unsupported for review-only sources');
  return true;
}
async function unsupportedApply(reason='review-only'){ return { supported:false, reason }; }
module.exports = { assertSourceAdapter, unsupportedApply };
