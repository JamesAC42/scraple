export const STREAK_STORAGE_KEYS = {
  daily: {
    countKey: 'scraple_daily_streak_count',
    lastDateKey: 'scraple_daily_streak_last_date'
  },
  blitz: {
    countKey: 'scraple_blitz_streak_count',
    lastDateKey: 'scraple_blitz_streak_last_date'
  }
};

const normalizeDate = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return '';
};

const toUtcDate = (dateString) => {
  const normalized = normalizeDate(dateString);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const getDayDiff = (fromDate, toDate) => {
  const from = toUtcDate(fromDate);
  const to = toUtcDate(toDate);
  if (!from || !to) return null;
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
};

const getModeConfig = (mode) => STREAK_STORAGE_KEYS[mode] || STREAK_STORAGE_KEYS.daily;

export const getStoredStreakState = (mode) => {
  if (typeof window === 'undefined') {
    return { count: 0, lastDate: '' };
  }

  const { countKey, lastDateKey } = getModeConfig(mode);
  const rawCount = Number(localStorage.getItem(countKey));
  const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
  const lastDate = normalizeDate(localStorage.getItem(lastDateKey) || '');

  return { count, lastDate };
};

export const updateStreakOnPuzzleComplete = ({ mode, puzzleDate }) => {
  if (typeof window === 'undefined') return 0;

  const normalizedPuzzleDate = normalizeDate(puzzleDate);
  if (!normalizedPuzzleDate) return 0;

  const { countKey, lastDateKey } = getModeConfig(mode);
  const { count: previousCount, lastDate } = getStoredStreakState(mode);

  let nextCount = 1;
  if (lastDate) {
    const dayDiff = getDayDiff(lastDate, normalizedPuzzleDate);

    if (dayDiff === null) {
      nextCount = 1;
    } else if (dayDiff <= 0) {
      nextCount = Math.max(1, previousCount);
    } else if (dayDiff > 2) {
      nextCount = 1;
    } else {
      nextCount = Math.max(1, previousCount) + 1;
    }
  }

  localStorage.setItem(countKey, String(nextCount));
  localStorage.setItem(lastDateKey, normalizedPuzzleDate);

  return nextCount;
};
