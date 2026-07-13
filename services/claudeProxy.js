// Server-side Claude proxy. Ports the system prompt and parsing logic that used to
// live in the Suund app's claudeService.ts (which called Anthropic directly from the
// client using EXPO_PUBLIC_ANTHROPIC_API_KEY). The key now lives only here.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';

const ANALYZE_MAX_TOKENS = 350;
const CHAT_MAX_TOKENS = 600;

const MAX_CHAT_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;

// Unchanged from the app's original SYSTEM_PROMPT — same personality, same tag format,
// so existing app-side parsing of the response keeps working.
const ANALYZE_SYSTEM_PROMPT = `Sa oled tervisnõustaja. Anna lühike hommikukokkuvõte kasutaja terviseandmete põhjal.

Reeglid:
- Ole otsekohene ja aus – mitte üldjuhul innustav. Kui andmed on halvad, ütle seda selgelt.
- Anna üks konkreetne tegevussoovitus tänaseks (näiteks: treeni kergelt, mine vara magama, joo rohkem vett). Mitte üldine nõuanne.
- Kokku maksimaalselt 3–4 lauset.
- Viimane rida PEAB algama täpselt nii: "Märksõnad:" ja sisaldama 2–3 lühikest märksõna komaga eraldatult (nt "Märksõnad: Unevõlg 1.2h, Treeni kergelt, HRV madal").
- Kui andmeid pole, tunnista seda ausalt – ära leiuta numbreid.
- Vasta AINULT eesti keeles.`;

// Same personality, adapted for multi-turn conversation instead of a one-shot summary
// (no forced "Märksõnad:" line — that only makes sense for the single morning summary).
const CHAT_SYSTEM_PROMPT = `Sa oled tervisnõustaja, kes vestleb kasutajaga tema terviseandmete põhjal.

Reeglid:
- Ole otsekohene ja aus – mitte pealiskaudselt innustav. Kui midagi on halvasti, ütle seda selgelt.
- Kui annad soovituse, anna üks konkreetne tegevus, mitte üldine nõuanne.
- Ole lühike – paar lauset korraga, mitte pikk essee.
- Kui andmeid pole või küsimus eeldab andmeid, mida sul pole, tunnista seda ausalt – ära leiuta numbreid.
- Vasta AINULT eesti keeles.`;

// Mirrors the fields the app's buildUserMessage() reads off HealthDashboardSnapshot
// (today's entry from snapshot.sleep[0] / heart[0] / activity[0]), without pulling
// the app's full historical-array type into this repo.
function buildHealthContextLine(healthData) {
  if (!healthData || typeof healthData !== 'object') {
    return 'terviseandmed puuduvad';
  }

  const { sleep, heart, activity } = healthData;
  const parts = [];

  if (sleep && typeof sleep.durationHours === 'number') {
    parts.push(`Uni: ${sleep.durationHours.toFixed(1)}h`);
    if (typeof sleep.efficiencyPercent === 'number') {
      parts.push(`une efektiivsus: ${sleep.efficiencyPercent}%`);
    }
    if (sleep.stages && typeof sleep.stages.deepMinutes === 'number') {
      parts.push(`sügav uni: ${sleep.stages.deepMinutes} min`);
    }
    if (sleep.stages && typeof sleep.stages.remMinutes === 'number') {
      parts.push(`REM: ${sleep.stages.remMinutes} min`);
    }
  } else {
    parts.push('uneandmed puuduvad');
  }

  if (heart && typeof heart.hrvRmssdMs === 'number') {
    parts.push(`HRV: ${heart.hrvRmssdMs.toFixed(0)} ms`);
  } else {
    parts.push('HRV andmed puuduvad');
  }

  if (heart && typeof heart.restingHeartRateBpm === 'number') {
    parts.push(`pulss puhkeolekus: ${heart.restingHeartRateBpm.toFixed(0)} lööki/min`);
  }

  if (activity && typeof activity.steps === 'number') {
    parts.push(`sammud tänaseni: ${activity.steps}`);
  }

  if (activity && typeof activity.activeMinutes === 'number') {
    parts.push(`aktiivne aeg: ${activity.activeMinutes} min`);
  }

  return parts.join('; ');
}

// Same "Märksõnad:" parsing the app used to do client-side.
function parseAnalysis(rawText) {
  const text = (rawText || '').trim();
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  let summary = text;
  let tags = [];

  const tagLineIndex = lines.findIndex((line) => line.startsWith('Märksõnad:'));
  if (tagLineIndex !== -1) {
    const tagLine = lines[tagLineIndex].replace('Märksõnad:', '').trim();
    tags = tagLine.split(',').map((tag) => tag.trim()).filter(Boolean);
    summary = lines.slice(0, tagLineIndex).join('\n').trim();
  }

  return { summary, tags };
}

function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { valid: false, error: 'messages array is required and must be non-empty' };
  }
  if (messages.length > MAX_CHAT_MESSAGES) {
    return { valid: false, error: `messages array exceeds max length of ${MAX_CHAT_MESSAGES}` };
  }
  for (const message of messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
      return { valid: false, error: 'each message must have role "user" or "assistant"' };
    }
    if (typeof message.content !== 'string' || message.content.trim().length === 0) {
      return { valid: false, error: 'each message must have non-empty string content' };
    }
    if (message.content.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: `message content exceeds max length of ${MAX_MESSAGE_LENGTH} characters` };
    }
  }
  return { valid: true };
}

async function callClaude({ apiKey, system, messages, maxTokens }) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Claude API error ${response.status}${body ? `: ${body}` : ''}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((block) => block.type === 'text');
  return (textBlock && textBlock.text ? textBlock.text : '').trim();
}

async function analyzeHealthData({ apiKey, healthData }) {
  const contextLine = buildHealthContextLine(healthData);
  const userMessage = `Terviseandmed: ${contextLine}. Anna hommikukokkuvõte.`;

  const text = await callClaude({
    apiKey,
    system: ANALYZE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: ANALYZE_MAX_TOKENS,
  });

  return parseAnalysis(text);
}

async function chatWithHealthContext({ apiKey, healthData, messages }) {
  const contextLine = buildHealthContextLine(healthData);
  const system = `${CHAT_SYSTEM_PROMPT}\n\nKasutaja tänased terviseandmed: ${contextLine}.`;

  const text = await callClaude({
    apiKey,
    system,
    messages,
    maxTokens: CHAT_MAX_TOKENS,
  });

  return { message: text };
}

module.exports = {
  analyzeHealthData,
  chatWithHealthContext,
  validateChatMessages,
  parseAnalysis,
  buildHealthContextLine,
  MODEL,
  ANALYZE_MAX_TOKENS,
  CHAT_MAX_TOKENS,
  MAX_CHAT_MESSAGES,
  MAX_MESSAGE_LENGTH,
};
