/**
 * Add alongside Code.gs. The legacy doPost feed stays available during rollout.
 * Properties: LAB_SHEET_SYNC_SECRET (same as worker), SHEET_ID (standalone script).
 * Run installLabSync once after deploying the migration and lab-sheet-sync worker.
 */
function syncLabMooney() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, error: 'BUSY' };
  var properties = PropertiesService.getScriptProperties();
  try {
    var secret = properties.getProperty('LAB_SHEET_SYNC_SECRET') || '';
    if (secret.length < 32) throw new Error('LAB_SYNC_NOT_CONFIGURED');
    // Capture BEFORE reading. A slower older read must not overwrite a newer snapshot.
    var sourceReadAt = new Date().toISOString();
    var collected = collectRows_(openSpreadsheet_());
    // An invalid row is an incomplete snapshot, never permission to delete that row in the mirror.
    if (collected.problems.length || !collected.rows.length || collected.rows.length > MAX_ROWS_) {
      throw new Error('LAB_SYNC_INVALID_SNAPSHOT');
    }
    var response = UrlFetchApp.fetch(SUPABASE_URL_ + '/functions/v1/lab-sheet-sync', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-lab-sync-secret': secret },
      payload: JSON.stringify({ source_read_at: sourceReadAt, problem_count: 0, rows: collected.rows }),
      muteHttpExceptions: true,
      followRedirects: false
    });
    var body;
    try { body = JSON.parse(response.getContentText()); } catch (_error) { throw new Error('LAB_SYNC_FAILED'); }
    if (response.getResponseCode() !== 200 || body.ok !== true) throw new Error('LAB_SYNC_FAILED');
    properties.setProperty('LAB_SYNC_LAST_SUCCESS', sourceReadAt);
    properties.deleteProperty('LAB_SYNC_LAST_ERROR');
    return { ok: true, rows: collected.rows.length, applied: body.applied };
  } catch (error) {
    // No response body, tokens, sheet contents or exception details in trigger logs.
    var allowed = ['LAB_SYNC_NOT_CONFIGURED', 'LAB_SYNC_INVALID_SNAPSHOT', 'LAB_SYNC_FAILED'];
    var code = allowed.indexOf(String(error.message)) >= 0 ? error.message : 'LAB_SYNC_FAILED';
    properties.setProperty('LAB_SYNC_LAST_ERROR', new Date().toISOString() + ' ' + code);
    throw new Error(code);
  } finally {
    lock.releaseLock();
  }
}

function installLabSync() {
  var result = syncLabMooney();
  if (!result.ok) throw new Error('LAB_SYNC_BUSY');
  removeLabSyncTrigger();
  ScriptApp.newTrigger('syncLabMooney').timeBased().everyMinutes(1).create();
}

function removeLabSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncLabMooney') ScriptApp.deleteTrigger(trigger);
  });
}
