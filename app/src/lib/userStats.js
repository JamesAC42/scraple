const USER_STATS_STORAGE_KEY = 'scraple_user_stats_v1';
const MAX_HISTORY_ENTRIES = 730;

const getEtTodayString = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York'
  }).format(new Date());
};

const safeParse = (rawValue) => {
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
};

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildSummaryFromHistory = (history) => {
  const summarizeMode = (mode) => {
    const modeEntries = history.filter((entry) => entry.mode === mode);
    if (modeEntries.length === 0) {
      return { average: 0, high: 0 };
    }

    let modeTotal = 0;
    let modeHigh = modeEntries[0].score;
    modeEntries.forEach((entry) => {
      modeTotal += entry.score;
      if (entry.score > modeHigh) modeHigh = entry.score;
    });

    return {
      average: Number((modeTotal / modeEntries.length).toFixed(2)),
      high: modeHigh
    };
  };

  if (!Array.isArray(history) || history.length === 0) {
    return {
      averageScore: 0,
      highScore: 0,
      dailyAverageScore: 0,
      dailyHighScore: 0,
      blitzAverageScore: 0,
      blitzHighScore: 0,
      gamesPlayed: 0
    };
  }

  let totalScore = 0;
  let highScore = history[0].score;
  history.forEach((entry) => {
    totalScore += entry.score;
    if (entry.score > highScore) highScore = entry.score;
  });

  const averageScore = Number((totalScore / history.length).toFixed(2));
  const dailySummary = summarizeMode('daily');
  const blitzSummary = summarizeMode('blitz');

  return {
    averageScore,
    highScore,
    dailyAverageScore: dailySummary.average,
    dailyHighScore: dailySummary.high,
    blitzAverageScore: blitzSummary.average,
    blitzHighScore: blitzSummary.high,
    gamesPlayed: history.length
  };
};

const normalizeStoredStats = (rawStats) => {
  const parsedHistory = Array.isArray(rawStats?.history) ? rawStats.history : [];
  const rawByDate = rawStats?.byDate && typeof rawStats.byDate === 'object' ? rawStats.byDate : {};

  const history = parsedHistory
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-MAX_HISTORY_ENTRIES)
    .map((entry) => ({
      id: String(entry.id || ''),
      date: String(entry.date || ''),
      mode: String(entry.mode || 'daily'),
      score: toFiniteNumber(entry.score, 0),
      puzzleId: entry.puzzleId ? String(entry.puzzleId) : null,
      displayDate: entry.displayDate ? String(entry.displayDate) : '',
      completedAt: entry.completedAt ? String(entry.completedAt) : '',
      boardState: entry.boardState && typeof entry.boardState === 'object'
        ? entry.boardState
        : { placedTiles: {}, bonusTilePositions: {} }
    }));

  const byDate = {};
  Object.entries(rawByDate).forEach(([dateKey, value]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return;
    if (!value || typeof value !== 'object') return;

    // Backward compatibility: old shape stored a single entry per date.
    if (typeof value.score === 'number' || typeof value.mode === 'string') {
      const entryMode = String(value.mode || 'daily');
      byDate[dateKey] = {
        [entryMode]: value
      };
      return;
    }

    const perModeEntries = {};
    Object.entries(value).forEach(([modeKey, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      perModeEntries[String(modeKey)] = entry;
    });
    byDate[dateKey] = perModeEntries;
  });

  const historySummary = buildSummaryFromHistory(history);

  return {
    version: 1,
    averageScore: historySummary.averageScore,
    highScore: historySummary.highScore,
    dailyAverageScore: historySummary.dailyAverageScore,
    dailyHighScore: historySummary.dailyHighScore,
    blitzAverageScore: historySummary.blitzAverageScore,
    blitzHighScore: historySummary.blitzHighScore,
    gamesPlayed: historySummary.gamesPlayed,
    updatedAt: String(rawStats?.updatedAt || ''),
    history,
    byDate
  };
};

const getStoredUserStats = () => {
  if (typeof window === 'undefined') return normalizeStoredStats(null);
  const parsed = safeParse(localStorage.getItem(USER_STATS_STORAGE_KEY));
  return normalizeStoredStats(parsed);
};

const notifyStatsUpdated = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('scraple:user-stats-updated'));
};

const saveStoredUserStats = (stats) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_STATS_STORAGE_KEY, JSON.stringify(stats));
};

const recalculateSummary = (history) => {
  return buildSummaryFromHistory(history);
};

export const recordCompletedGameStats = ({
  date,
  mode = 'daily',
  score,
  puzzleId = null,
  displayDate = '',
  placedTiles = {},
  bonusTilePositions = {}
}) => {
  if (typeof window === 'undefined') return null;
  if (!Number.isFinite(Number(score))) return null;

  const safeDate = String(date || getEtTodayString());
  const safeMode = String(mode || 'daily');
  const safeScore = Number(score);
  const safePuzzleId = puzzleId ? String(puzzleId) : null;
  const completedAt = new Date().toISOString();
  const entryId = `${safeDate}|${safeMode}|${safePuzzleId || 'none'}`;

  const nextEntry = {
    id: entryId,
    date: safeDate,
    mode: safeMode,
    score: safeScore,
    puzzleId: safePuzzleId,
    displayDate: String(displayDate || ''),
    completedAt,
    boardState: {
      placedTiles: placedTiles && typeof placedTiles === 'object' ? placedTiles : {},
      bonusTilePositions: bonusTilePositions && typeof bonusTilePositions === 'object' ? bonusTilePositions : {}
    }
  };

  const current = getStoredUserStats();
  const historyWithoutDuplicate = current.history.filter((entry) => entry.id !== entryId);
  const history = [...historyWithoutDuplicate, nextEntry].slice(-MAX_HISTORY_ENTRIES);
  const existingDateEntries = current.byDate?.[safeDate] && typeof current.byDate[safeDate] === 'object'
    ? current.byDate[safeDate]
    : {};

  const byDate = {
    ...(current.byDate || {}),
    [safeDate]: {
      ...existingDateEntries,
      [safeMode]: nextEntry
    }
  };

  const summary = recalculateSummary(history);
  const nextStats = {
    version: 1,
    ...summary,
    history,
    byDate,
    updatedAt: completedAt
  };

  saveStoredUserStats(nextStats);
  notifyStatsUpdated();
  return nextStats;
};

export const seedSampleUserStats = () => {
  if (typeof window === 'undefined') return null;

  const now = new Date();
  const history = [];
  const byDate = {};

  for (let i = 45; i >= 0; i -= 3) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const dateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York'
    }).format(date);

    const dailyEntry = {
      id: `${dateKey}|daily|sample-d-${i}`,
      date: dateKey,
      mode: 'daily',
      score: 75 + ((i * 11) % 95),
      puzzleId: `sample-daily-${i}`,
      displayDate: date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }),
      completedAt: new Date(date.getTime() + 18 * 60 * 60 * 1000).toISOString(),
      boardState: {
        placedTiles: {
          '1-1': { letter: 'S', points: 1 },
          '1-2': { letter: 'T', points: 1 },
          '1-3': { letter: 'A', points: 1 },
          '1-4': { letter: 'R', points: 1 },
          '2-2': { letter: 'A', points: 1 },
          '3-2': { letter: 'X', points: 8 }
        },
        bonusTilePositions: {
          DOUBLE_LETTER: [1, 3],
          TRIPLE_LETTER: [3, 2],
          DOUBLE_WORD: [1, 1],
          TRIPLE_WORD: [0, 4]
        }
      }
    };
    const blitzEntry = {
      ...dailyEntry,
      id: `${dateKey}|blitz|sample-b-${i}`,
      mode: 'blitz',
      score: 45 + ((i * 13) % 90),
      puzzleId: `sample-blitz-${i}`
    };

    history.push(dailyEntry, blitzEntry);
    byDate[dateKey] = {
      daily: dailyEntry,
      blitz: blitzEntry
    };
  }

  const summary = recalculateSummary(history);
  const nextStats = {
    version: 1,
    ...summary,
    history,
    byDate,
    updatedAt: new Date().toISOString()
  };

  saveStoredUserStats(nextStats);
  notifyStatsUpdated();
  return nextStats;
};

export const clearStoredUserStats = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_STATS_STORAGE_KEY);
  notifyStatsUpdated();
};

export const getUserStatsSnapshot = () => {
  return getStoredUserStats();
};

export { USER_STATS_STORAGE_KEY };
