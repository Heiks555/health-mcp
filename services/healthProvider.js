const DEFAULT_BASE_URL = 'https://backend-production-21d7.up.railway.app';

function normalizeProviderName(value) {
  if (value === 'mock') return 'mock';
  return 'openwearables';
}

function generateMockSleepData() {
  const duration = Math.floor(Math.random() * 2) + 7;
  const deepSleep = Math.floor(Math.random() * 10) + 15;
  const rem = Math.floor(Math.random() * 5) + 20;
  const hrv = Math.floor(Math.random() * 30) + 50;
  return { duration_hours: duration, deep_sleep_percentage: deepSleep, rem_percentage: rem, hrv_ms: hrv };
}

function generateMockActivityData() {
  const steps = Math.floor(Math.random() * 7000) + 8000;
  const calories = Math.floor(Math.random() * 300) + 300;
  const activeMinutes = Math.floor(Math.random() * 30) + 30;
  return { steps, calories_burned: calories, active_minutes: activeMinutes };
}

function generateMockNutritionData() {
  const calories = Math.floor(Math.random() * 500) + 2000;
  const protein = Math.floor(Math.random() * 50) + 100;
  const carbs = Math.floor(Math.random() * 100) + 200;
  const fat = Math.floor(Math.random() * 40) + 60;
  const water = parseFloat((Math.random() * 1 + 2).toFixed(2));
  return { calories, protein_grams: protein, carbs_grams: carbs, fat_grams: fat, water_liters: water };
}

function generateMockHealthStatus() {
  return {
    status: 'ok',
    provider: 'mock',
    message: 'Using mock health data',
    source: 'mock',
  };
}

function toDateString(date) {
  return date.toISOString().split('T')[0];
}

function getDateRange(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start, end };
}

function createHealthProvider(options = {}) {
  const baseUrl = options.baseUrl || process.env.OW_BASE_URL || DEFAULT_BASE_URL;
  const configuredProvider = normalizeProviderName(options.provider || process.env.HEALTH_PROVIDER || 'openwearables');
  const apiKey = options.apiKey || process.env.OW_API_KEY || '';
  const mode = configuredProvider;

  const headers = {
    'Accept': 'application/json',
    'X-Open-Wearables-API-Key': apiKey,
  };

  async function requestJson(path, init = {}) {
    const url = new URL(path, baseUrl).toString();
    const response = await fetch(url, {
      method: 'GET',
      headers,
      ...init,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Open Wearables request failed (${response.status} ${response.statusText}): ${text}`);
    }

    return response.json();
  }

  async function findFirstUser() {
    const users = await requestJson('/api/v1/users?limit=5');
    if (!users?.items?.length) {
      throw new Error('No Open Wearables users found');
    }
    return users.items[0];
  }

  function normalizeSleepData(entry) {
    if (!entry) {
      return generateMockSleepData();
    }

    const totalDurationMinutes = entry.total_duration_minutes ?? entry.duration_minutes ?? 0;
    const stages = entry.stages || {};
    const durationHours = totalDurationMinutes > 0 ? Number((totalDurationMinutes / 60).toFixed(2)) : 0;
    const deepSleepPercentage = totalDurationMinutes > 0 && typeof stages.deep_minutes === 'number'
      ? Number(((stages.deep_minutes / totalDurationMinutes) * 100).toFixed(2))
      : 0;
    const remPercentage = totalDurationMinutes > 0 && typeof stages.rem_minutes === 'number'
      ? Number(((stages.rem_minutes / totalDurationMinutes) * 100).toFixed(2))
      : 0;
    const hrvMs = entry.avg_hrv_sdnn_ms ?? entry.avg_hrv_rmssd_ms ?? null;

    return {
      duration_hours: durationHours,
      deep_sleep_percentage: deepSleepPercentage,
      rem_percentage: remPercentage,
      hrv_ms: hrvMs === null ? null : Number(hrvMs.toFixed(2)),
    };
  }

  function normalizeActivityData(entry) {
    if (!entry) {
      return generateMockActivityData();
    }

    const steps = Number(entry.steps || 0);
    const caloriesBurned = Number(entry.active_calories_kcal ?? entry.total_calories_kcal ?? 0);
    const activeMinutes = Number(entry.active_minutes ?? 0);

    return {
      steps,
      calories_burned: Number(caloriesBurned.toFixed(2)),
      active_minutes: Number(activeMinutes.toFixed(2)),
    };
  }

  async function getOpenWearablesData() {
    const user = await findFirstUser();
    const userId = user.id;
    const range = getDateRange(30);
    const sleepPayload = await requestJson(`/api/v1/users/${userId}/summaries/sleep?start_date=${toDateString(range.start)}&end_date=${toDateString(range.end)}&limit=30`);
    const activityPayload = await requestJson(`/api/v1/users/${userId}/summaries/activity?start_date=${toDateString(range.start)}&end_date=${toDateString(range.end)}&limit=30`);
    return { user, userId, sleepPayload, activityPayload };
  }

  return {
    getProviderName() {
      return mode;
    },

    async getHealthStatus() {
      if (mode === 'mock') {
        return generateMockHealthStatus();
      }

      try {
        const user = await findFirstUser();
        const healthScores = await requestJson(`/api/v1/users/${user.id}/health-scores?limit=1`);
        const latestScore = healthScores?.data?.[0] || null;
        return {
          status: 'ok',
          provider: 'openwearables',
          user_id: user.id,
          user_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
          latest_score: latestScore ? latestScore.value : null,
          category: latestScore ? latestScore.category : null,
          recorded_at: latestScore ? latestScore.recorded_at : null,
          source: 'openwearables',
        };
      } catch (error) {
        console.warn('Open Wearables health-status fetch failed, using mock data:', error.message);
        return generateMockHealthStatus();
      }
    },

    async getSleepData() {
      if (mode === 'mock') {
        return generateMockSleepData();
      }

      try {
        const { userId, sleepPayload } = await getOpenWearablesData();
        const latestEntry = sleepPayload?.data?.[0] || null;
        return normalizeSleepData(latestEntry);
      } catch (error) {
        console.warn('Open Wearables sleep fetch failed, using mock data:', error.message);
        return generateMockSleepData();
      }
    },

    async getActivityData() {
      if (mode === 'mock') {
        return generateMockActivityData();
      }

      try {
        const { activityPayload } = await getOpenWearablesData();
        const latestEntry = activityPayload?.data?.[0] || null;
        return normalizeActivityData(latestEntry);
      } catch (error) {
        console.warn('Open Wearables activity fetch failed, using mock data:', error.message);
        return generateMockActivityData();
      }
    },

    async getNutritionData() {
      return generateMockNutritionData();
    },

    async getWeeklySummary() {
      if (mode === 'mock') {
        return Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setUTCDate(date.getUTCDate() - (6 - index));
          return {
            date: toDateString(date),
            sleep: generateMockSleepData(),
            activity: generateMockActivityData(),
            nutrition: generateMockNutritionData(),
          };
        });
      }

      try {
        const { userId, sleepPayload, activityPayload } = await getOpenWearablesData();
        const sleepByDate = new Map((sleepPayload?.data || []).map((entry) => [entry.date, entry]));
        const activityByDate = new Map((activityPayload?.data || []).map((entry) => [entry.date, entry]));
        const summary = [];
        const range = getDateRange(7);
        for (let day = 6; day >= 0; day -= 1) {
          const date = new Date(range.end);
          date.setUTCDate(date.getUTCDate() - day);
          const dateKey = toDateString(date);
          summary.push({
            date: dateKey,
            sleep: normalizeSleepData(sleepByDate.get(dateKey)),
            activity: normalizeActivityData(activityByDate.get(dateKey)),
            nutrition: generateMockNutritionData(),
            user_id: userId,
          });
        }
        return summary;
      } catch (error) {
        console.warn('Open Wearables weekly-summary fetch failed, using mock data:', error.message);
        return Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setUTCDate(date.getUTCDate() - (6 - index));
          return {
            date: toDateString(date),
            sleep: generateMockSleepData(),
            activity: generateMockActivityData(),
            nutrition: generateMockNutritionData(),
          };
        });
      }
    },
  };
}

module.exports = {
  createHealthProvider,
  generateMockSleepData,
  generateMockActivityData,
  generateMockNutritionData,
};
