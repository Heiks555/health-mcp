const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAnalysis, validateChatMessages, buildHealthContextLine } = require('../services/claudeProxy');

test('parseAnalysis splits summary from the Märksõnad tag line', () => {
  const raw = 'Magasid vähe ja HRV on madal.\nMärksõnad: Unevõlg 1.2h, HRV madal';
  const { summary, tags } = parseAnalysis(raw);
  assert.equal(summary, 'Magasid vähe ja HRV on madal.');
  assert.deepEqual(tags, ['Unevõlg 1.2h', 'HRV madal']);
});

test('parseAnalysis returns the whole text as summary when there is no tag line', () => {
  const raw = 'Andmeid pole piisavalt.';
  const { summary, tags } = parseAnalysis(raw);
  assert.equal(summary, 'Andmeid pole piisavalt.');
  assert.deepEqual(tags, []);
});

test('buildHealthContextLine acknowledges missing data instead of inventing numbers', () => {
  const line = buildHealthContextLine(null);
  assert.match(line, /puuduvad/);
});

test('buildHealthContextLine includes provided fields', () => {
  const line = buildHealthContextLine({
    sleep: { durationHours: 6.5 },
    heart: { hrvRmssdMs: 42 },
    activity: { steps: 8000 },
  });
  assert.match(line, /Uni: 6\.5h/);
  assert.match(line, /HRV: 42 ms/);
  assert.match(line, /sammud tänaseni: 8000/);
});

test('validateChatMessages rejects an empty array', () => {
  const result = validateChatMessages([]);
  assert.equal(result.valid, false);
});

test('validateChatMessages rejects a non-user/assistant role', () => {
  const result = validateChatMessages([{ role: 'system', content: 'hi' }]);
  assert.equal(result.valid, false);
});

test('validateChatMessages accepts a well-formed history', () => {
  const result = validateChatMessages([
    { role: 'user', content: 'Kuidas mul läheb?' },
    { role: 'assistant', content: 'Vajad rohkem und.' },
  ]);
  assert.equal(result.valid, true);
});
