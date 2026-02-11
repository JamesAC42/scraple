'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './BotGamePopup.module.scss';

const BONUS_LABELS = {
  DOUBLE_LETTER: '2L',
  TRIPLE_LETTER: '3L',
  DOUBLE_WORD: '2W',
  TRIPLE_WORD: '3W'
};

const renderFormattedDefinition = (definition, styles) => {
  if (!definition) return null;
  const segments = definition.split(/(\([^)]+\)|\[[^\]]+\])/g).filter(Boolean);
  return segments.map((segment, index) => {
    const parenMatch = segment.match(/^\((.*)\)$/);
    if (parenMatch) {
      return (
        <span key={`def-${index}`} className={styles.definitionParen}>
          (<strong>{parenMatch[1]}</strong>)
        </span>
      );
    }

    const bracketMatch = segment.match(/^\[(.*)\]$/);
    if (bracketMatch) {
      return (
        <span key={`def-${index}`} className={styles.definitionBracket}>
          [{bracketMatch[1]}]
        </span>
      );
    }

    return <span key={`def-${index}`}>{segment}</span>;
  });
};

const normalizeDateString = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slashMatch) return '';
  const month = slashMatch[1].padStart(2, '0');
  const day = slashMatch[2].padStart(2, '0');
  const year = slashMatch[3];
  return `${year}-${month}-${day}`;
};

const getBonusTypeForCell = (bonusTilePositions, row, col) => {
  if (!bonusTilePositions || typeof bonusTilePositions !== 'object') return null;
  for (const [bonusType, coords] of Object.entries(bonusTilePositions)) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    if (Number(coords[0]) === row && Number(coords[1]) === col) return bonusType;
  }
  return null;
};

const tileFromPlaced = (placedTiles, row, col) => {
  const key = `${row}-${col}`;
  const value = placedTiles?.[key];
  if (!value || typeof value !== 'object') return null;
  if (!value.letter) return null;
  return value;
};

const BotGamePopup = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingBreakdown, setIsLoadingBreakdown] = useState(false);
  const [error, setError] = useState('');
  const [botGame, setBotGame] = useState(null);
  const [botWordBreakdown, setBotWordBreakdown] = useState([]);

  const targetDate = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return normalizeDateString(localStorage.getItem('scraple_game_date') || '');
  }, []);

  const fetchBotWordBreakdown = async () => {
    setIsLoadingBreakdown(true);
    try {
      const query = targetDate ? `?date=${encodeURIComponent(targetDate)}` : '';
      const response = await fetch(`/api/bot-daily-word-breakdown${query}`);
      if (!response.ok) {
        if (response.status === 404) {
          setBotWordBreakdown([]);
          return;
        }
        throw new Error(`Failed to fetch bot word breakdown: ${response.status}`);
      }
      const data = await response.json();
      setBotWordBreakdown(Array.isArray(data.words) ? data.words : []);
    } catch (fetchError) {
      console.error('Error fetching bot word breakdown:', fetchError);
      setBotWordBreakdown([]);
    } finally {
      setIsLoadingBreakdown(false);
    }
  };

  const fetchBotGame = async () => {
    setIsLoading(true);
    setError('');
    try {
      const query = targetDate ? `?date=${encodeURIComponent(targetDate)}` : '';
      const response = await fetch(`/api/bot-daily${query}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Bot game is still generating. Try again in a moment.');
          setBotGame(null);
          return;
        }
        throw new Error(`Failed to fetch bot game: ${response.status}`);
      }

      const data = await response.json();
      setBotGame(data);
      fetchBotWordBreakdown();
    } catch (fetchError) {
      console.error('Error fetching bot game:', fetchError);
      setError('Failed to load bot game.');
      setBotGame(null);
      setBotWordBreakdown([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBotGame();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <div className={styles.infoText}>Loading bot game...</div>;
  }

  if (error) {
    return (
      <div className={styles.infoWrap}>
        <div className={styles.infoText}>{error}</div>
        <button className={styles.retryButton} onClick={fetchBotGame}>
          Retry
        </button>
      </div>
    );
  }

  if (!botGame) {
    return <div className={styles.infoText}>No bot game available.</div>;
  }

  const words = botWordBreakdown.length > 0 ? botWordBreakdown : (Array.isArray(botGame.words) ? botGame.words : []);
  const placedTiles = botGame.placedTiles || {};
  const bonusTilePositions = botGame.bonusTilePositions || {};

  return (
    <div className={styles.container}>
      <div className={styles.metaRow}>
        <span>Date: <strong>{botGame.date || targetDate || 'Unknown'}</strong></span>
        <span>
          Score:{' '}
          <strong className={typeof botGame.score === 'number' && botGame.score >= 0 ? styles.positive : styles.negative}>
            {typeof botGame.score === 'number' ? botGame.score : 'N/A'}
          </strong>
        </span>
      </div>

      <div className={styles.boardShowcase}>
        <img
          src="/images/robot-awake.png"
          alt="ScrapleBot awake"
          className={styles.botAwakeImage}
        />
        <div className={styles.board}>
          {Array.from({ length: 5 }).map((_, row) => (
            <div className={styles.boardRow} key={`bot-row-${row}`}>
              {Array.from({ length: 5 }).map((_, col) => {
                const tile = tileFromPlaced(placedTiles, row, col);
                const bonusType = getBonusTypeForCell(bonusTilePositions, row, col);
                return (
                  <div
                    key={`bot-cell-${row}-${col}`}
                    className={`${styles.cell} ${bonusType ? styles[bonusType] : ''}`}
                  >
                    {tile ? (
                      <div className={styles.tile}>
                        <span className={styles.tileLetter}>{String(tile.letter || '').toUpperCase()}</span>
                        <span className={styles.tilePoints}>{typeof tile.points === 'number' ? tile.points : ''}</span>
                      </div>
                    ) : (
                      bonusType ? <span className={styles.bonusLabel}>{BONUS_LABELS[bonusType] || ''}</span> : null
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.wordsSection}>
        <h3>Bot Word Breakdown</h3>
        {isLoadingBreakdown && <div className={styles.infoText}>Loading definitions and usage stats...</div>}
        {words.length === 0 && <div className={styles.infoText}>No words found.</div>}
        {words.length > 0 && (
          <ul className={styles.wordsList}>
            {words.map((wordResult, index) => (
              <li
                key={`${wordResult.word || 'word'}-${index}`}
                className={`${styles.wordItem} ${wordResult.valid ? styles.validWord : styles.invalidWord}`}
              >
                <div className={styles.wordTopRow}>
                  <span className={styles.wordText}>{String(wordResult.word || '').toUpperCase()}</span>
                  <div className={styles.wordTopRight}>
                    <span className={styles.wordScore}>
                      {typeof wordResult.score === 'number' && wordResult.score >= 0 ? '+' : ''}
                      {wordResult.score}
                    </span>
                    {Array.isArray(wordResult.usedBonusTypes) && wordResult.usedBonusTypes.length > 0 && (
                      <span className={styles.bonusIcons}>
                        {wordResult.usedBonusTypes.map((bonusType) => (
                          <span key={`${wordResult.word}-${bonusType}`} className={`${styles.bonusIcon} ${styles[`bonus${bonusType}`]}`}>
                            {BONUS_LABELS[bonusType] || bonusType}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                {wordResult.bonusPraise && (
                  <div className={styles.bonusPraise}>★ {wordResult.bonusPraise}</div>
                )}
                <div className={styles.definition}>
                  {wordResult.definition
                    ? renderFormattedDefinition(wordResult.definition, styles)
                    : (wordResult.valid ? 'Definition unavailable.' : 'Not a valid dictionary word.')}
                </div>
                <div className={styles.meta}>
                  {wordResult.playedByOthersCount === null || wordResult.playedByOthersCount === undefined
                    ? 'Usage stats loading...'
                    : `${wordResult.playedByOthersCount} other player${wordResult.playedByOthersCount === 1 ? '' : 's'} used this word today`}
                </div>
                <div className={styles.metaSecondary}>
                  {typeof wordResult.averageScoreAmongPlayers === 'number'
                    ? `Average score of players who used this word: ${wordResult.averageScoreAmongPlayers.toFixed(2)}`
                    : 'Average score of players who used this word: loading...'}
                </div>
                {(wordResult.isHighScoringSpecial || wordResult.isUniqueTodaySpecial) && (
                  <div className={styles.specialTags}>
                    {wordResult.isHighScoringSpecial && <span className={`${styles.specialTag} ${styles.specialTagHigh}`}>50+ POINT WORD</span>}
                    {wordResult.isUniqueTodaySpecial && <span className={`${styles.specialTag} ${styles.specialTagUnique}`}>UNIQUE TODAY</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BotGamePopup;
