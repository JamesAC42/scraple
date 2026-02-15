'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './ProfilePopup.module.scss';
import {
  PLAYER_ID_KEY,
  NICKNAME_MAX_LENGTH,
  getPlayerHash,
  getStoredNickname,
  saveNicknameToServer,
  setStoredNickname,
  validateNickname
} from '@/lib/nickname';
import { getStoredStreakState } from '@/lib/streaks';
import { getUserStatsSnapshot } from '@/lib/userStats';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODE_ORDER = ['daily', 'blitz', 'practice'];

const pad2 = (value) => String(value).padStart(2, '0');
const buildDateKey = (year, monthIndex, dayOfMonth) => `${year}-${pad2(monthIndex + 1)}-${pad2(dayOfMonth)}`;

const parseDateKey = (dateKey) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const [year, month, day] = String(dateKey).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const getEntriesForDate = (statsByDate, dateKey) => {
  const dateBucket = statsByDate?.[dateKey];
  if (!dateBucket || typeof dateBucket !== 'object') return [];

  return Object.entries(dateBucket)
    .map(([modeKey, entry]) => ({
      modeKey,
      entry
    }))
    .filter((item) => item.entry && typeof item.entry === 'object')
    .sort((a, b) => {
      const aIndex = MODE_ORDER.indexOf(a.modeKey);
      const bIndex = MODE_ORDER.indexOf(b.modeKey);
      if (aIndex === -1 && bIndex === -1) return a.modeKey.localeCompare(b.modeKey);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    })
    .map((item) => item.entry);
};

const getBonusTypeAtCell = (bonusTilePositions, row, col) => {
  const checks = [
    'DOUBLE_LETTER',
    'TRIPLE_LETTER',
    'DOUBLE_WORD',
    'TRIPLE_WORD'
  ];
  for (const type of checks) {
    const pos = bonusTilePositions?.[type];
    if (Array.isArray(pos) && pos[0] === row && pos[1] === col) {
      return type;
    }
  }
  return '';
};

const ProfilePopup = () => {
  const [playerId, setPlayerId] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [dailyStreak, setDailyStreak] = useState(0);
  const [blitzStreak, setBlitzStreak] = useState(0);
  const [userStats, setUserStats] = useState({
    averageScore: 0,
    highScore: 0,
    dailyAverageScore: 0,
    dailyHighScore: 0,
    blitzAverageScore: 0,
    blitzHighScore: 0,
    gamesPlayed: 0,
    byDate: {},
    history: []
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedPlayerId = localStorage.getItem(PLAYER_ID_KEY) || '';
    setPlayerId(storedPlayerId);
    setNickname(getStoredNickname());
    setDailyStreak(getStoredStreakState('daily').count);
    setBlitzStreak(getStoredStreakState('blitz').count);
    const snapshot = getUserStatsSnapshot();
    setUserStats(snapshot);
    if (snapshot.history.length > 0) {
      const latestDate = snapshot.history
        .map((entry) => entry.date)
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
        .sort()
        .at(-1);
      if (latestDate) {
        setSelectedDateKey(latestDate);
        const parsed = parseDateKey(latestDate);
        if (parsed) {
          setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
        }
      }
    }
  }, []);

  useEffect(() => {
    const syncStreaks = () => {
      setDailyStreak(getStoredStreakState('daily').count);
      setBlitzStreak(getStoredStreakState('blitz').count);
    };
    const syncStats = () => {
      setUserStats(getUserStatsSnapshot());
    };

    window.addEventListener('scraple:streak-updated', syncStreaks);
    window.addEventListener('scraple:user-stats-updated', syncStats);
    window.addEventListener('storage', syncStreaks);
    window.addEventListener('storage', syncStats);
    return () => {
      window.removeEventListener('scraple:streak-updated', syncStreaks);
      window.removeEventListener('scraple:user-stats-updated', syncStats);
      window.removeEventListener('storage', syncStreaks);
      window.removeEventListener('storage', syncStats);
    };
  }, []);

  useEffect(() => {
    const hasSelectedEntry = selectedDateKey && getEntriesForDate(userStats.byDate, selectedDateKey).length > 0;
    if (hasSelectedEntry) return;
    if (!Array.isArray(userStats.history) || userStats.history.length === 0) return;

    const latestDate = userStats.history
      .map((entry) => entry.date)
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
      .sort()
      .at(-1);

    if (!latestDate) return;
    setSelectedDateKey(latestDate);

    const parsed = parseDateKey(latestDate);
    if (parsed) {
      setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    }
  }, [selectedDateKey, userStats.byDate, userStats.history]);

  const handleSave = async () => {
    setError('');
    setSavedMessage('');

    const validation = validateNickname(nickname);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    if (!playerId) {
      setError('Unable to save nickname right now.');
      return;
    }

    setIsSaving(true);
    try {
      const data = await saveNicknameToServer({
        playerId,
        nickname: validation.value
      });
      setStoredNickname(data.nickname || validation.value);
      setNickname(data.nickname || validation.value);
      setSavedMessage('Nickname updated.');
      window.dispatchEvent(new CustomEvent('scraple:nickname-updated'));
    } catch (saveError) {
      setError(saveError.message || 'Failed to save nickname.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveNickname = async () => {
    setError('');
    setSavedMessage('');

    if (!playerId) {
      setError('Unable to remove nickname right now.');
      return;
    }

    setIsSaving(true);
    try {
      await saveNicknameToServer({
        playerId,
        nickname: ''
      });
      setStoredNickname('');
      setNickname('');
      setSavedMessage('Nickname removed.');
      window.dispatchEvent(new CustomEvent('scraple:nickname-updated'));
    } catch (saveError) {
      setError(saveError.message || 'Failed to remove nickname.');
    } finally {
      setIsSaving(false);
    }
  };

  const playerHash = getPlayerHash(playerId);
  const monthYearLabel = calendarMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstDayIndex; i += 1) {
      cells.push({ key: `empty-${i}`, isEmpty: true });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = buildDateKey(year, month, day);
      const hasScore = getEntriesForDate(userStats.byDate, dateKey).length > 0;
      cells.push({
        key: dateKey,
        day,
        dateKey,
        hasScore,
        isSelected: selectedDateKey === dateKey
      });
    }

    return cells;
  }, [calendarMonth, selectedDateKey, userStats.byDate]);

  const selectedEntries = selectedDateKey ? getEntriesForDate(userStats.byDate, selectedDateKey) : [];
  const renderBoardRows = (entry, entryIndex) => {
    const placedTiles = entry?.boardState?.placedTiles || {};
    const bonusTiles = entry?.boardState?.bonusTilePositions || {};
    return Array.from({ length: 5 }, (_, row) => (
      <div key={`entry-${entryIndex}-row-${row}`} className={styles.boardPreviewRow}>
        {Array.from({ length: 5 }, (_, col) => {
          const cellKey = `${row}-${col}`;
          const tile = placedTiles[cellKey];
          const bonusType = getBonusTypeAtCell(bonusTiles, row, col);
          return (
            <div
              key={`entry-${entryIndex}-cell-${cellKey}`}
              className={`${styles.boardPreviewCell} ${bonusType ? styles[`bonus${bonusType}`] : ''}`}
            >
              {tile?.letter || ''}
            </div>
          );
        })}
      </div>
    ));
  };

  return (
    <div className={styles.profileContainer}>
      <div className={styles.streakSection}>
        <div className={styles.streakItem}>
          Daily streak: <strong>🔥 {dailyStreak}</strong>
        </div>
        <div className={styles.streakItem}>
          Blitz streak: <strong>🔥 {blitzStreak}</strong>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={`${styles.statCard} ${styles.avgCard}`}>
          <div className={styles.statLabel}>Daily average</div>
          <div className={styles.statValue}>{userStats.dailyAverageScore.toFixed(2)}</div>
        </div>
        <div className={`${styles.statCard} ${styles.highCard}`}>
          <div className={styles.statLabel}>Daily high</div>
          <div className={styles.statValue}>{userStats.dailyHighScore}</div>
        </div>
      </div>
      <div className={styles.statsRow}>
        <div className={`${styles.statCard} ${styles.blitzAvgCard}`}>
          <div className={styles.statLabel}>Blitz average</div>
          <div className={styles.statValue}>{userStats.blitzAverageScore.toFixed(2)}</div>
        </div>
        <div className={`${styles.statCard} ${styles.blitzHighCard}`}>
          <div className={styles.statLabel}>Blitz high</div>
          <div className={styles.statValue}>{userStats.blitzHighScore}</div>
        </div>
      </div>
      <div className={`${styles.statCard} ${styles.gamesCard}`}>
        <div className={styles.statLabel}>Total games played</div>
        <div className={styles.statValue}>{userStats.gamesPlayed}</div>
      </div>

      <div className={styles.calendarSection}>
        <div className={styles.calendarHeader}>
          <button
            className={styles.monthNavButton}
            onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <div className={styles.calendarMonthLabel}>{monthYearLabel}</div>
          <button
            className={styles.monthNavButton}
            onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className={styles.weekHeader}>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className={styles.weekHeaderCell}>{label}</div>
          ))}
        </div>
        <div className={styles.calendarGrid}>
          {calendarCells.map((cell) => {
            if (cell.isEmpty) {
              return <div key={cell.key} className={styles.emptyCell} />;
            }

            return (
              <button
                key={cell.key}
                className={`${styles.dayCell} ${cell.hasScore ? styles.dayWithScore : ''} ${cell.isSelected ? styles.daySelected : ''}`}
                onClick={() => {
                  if (cell.hasScore) {
                    setSelectedDateKey(cell.dateKey);
                  }
                }}
                disabled={!cell.hasScore}
                aria-label={cell.hasScore ? `View game for ${cell.dateKey}` : `No game for ${cell.dateKey}`}
              >
                <span>{cell.day}</span>
                {cell.hasScore && <span className={styles.scoreDot} />}
              </button>
            );
          })}
        </div>
      </div>

    <div className={styles.selectedGameSection}>
        {selectedEntries.length > 0 ? (
          <>
            {selectedEntries.map((entry, index) => (
              <div key={`${entry.id || entry.mode}-${index}`} className={styles.selectedEntryCard}>
                <div className={styles.selectedGameHeader}>
                  <strong>{entry.date}</strong>
                  <span className={styles.selectedMode}>{entry.mode}</span>
                  <span className={styles.selectedScore}>Score: {entry.score}</span>
                </div>
                <div className={styles.boardPreview}>
                  {renderBoardRows(entry, index)}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className={styles.selectedGameEmpty}>
            Select a date with a dot to view that board and score.
          </div>
        )}
      </div>

      <p className={styles.profileHint}>
        Your leaderboard identity is your nickname plus ID hash.
      </p>
      <div className={styles.hashRow}>ID hash: <strong>#{playerHash}</strong></div>

      <label className={styles.fieldLabel} htmlFor="profile-nickname-input">
        Nickname
      </label>
      <input
        id="profile-nickname-input"
        className={styles.nicknameInput}
        value={nickname}
        maxLength={NICKNAME_MAX_LENGTH}
        onChange={(event) => {
          setNickname(event.target.value);
          setError('');
          setSavedMessage('');
        }}
        placeholder="Enter nickname"
      />
      <div className={styles.inputMeta}>{nickname.length}/{NICKNAME_MAX_LENGTH}</div>

      {error && <div className={styles.error}>{error}</div>}
      {savedMessage && <div className={styles.saved}>{savedMessage}</div>}

      <div className={styles.actions}>
        <button className={styles.saveButton} onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          className={styles.removeButton}
          onClick={handleRemoveNickname}
          disabled={isSaving || !nickname.trim()}
        >
          Remove nickname
        </button>
      </div>
    </div>
  );
};

export default ProfilePopup;
