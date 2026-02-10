'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './LeaderboardPopup.module.scss';
import { IoMdRefresh } from 'react-icons/io';
import { getNicknameBadgeStyle, getPlayerHash } from '@/lib/nickname';

const normalizeDateString = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  return trimmed;
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

const bonusTileLabels = {
  DOUBLE_LETTER: "2L",
  TRIPLE_LETTER: "3L",
  DOUBLE_WORD: "2W",
  TRIPLE_WORD: "3W"
};

const getTodayDate = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York'
  }).format(new Date());
};

const LeaderboardPopup = ({ onClose }) => {
  const [leaderboard, setLeaderboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [mode, setMode] = useState('daily');
  const [modeCompletion, setModeCompletion] = useState({ daily: false, blitz: false });
  const [isModeReady, setIsModeReady] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState(null);
  const [wordBreakdownsByPlayer, setWordBreakdownsByPlayer] = useState({});
  const [breakdownLoadingByPlayer, setBreakdownLoadingByPlayer] = useState({});
  const [breakdownErrorByPlayer, setBreakdownErrorByPlayer] = useState({});
  const [showBreakdownHint, setShowBreakdownHint] = useState(false);
  const fetchRequestIdRef = useRef(0);

  const LEADERBOARD_MODE_KEY = 'scraple_leaderboard_mode';
  const DAILY_RESULTS_KEY = 'scraple_game_results';
  const BLITZ_RESULTS_KEY = 'scraple_blitz_game_results';
  const DAILY_DATE_KEY = 'scraple_game_date';
  const BLITZ_DATE_KEY = 'scraple_blitz_game_date';
  const BREAKDOWN_HINT_SEEN_KEY = 'scraple_leaderboard_breakdown_hint_seen';

  const hasCompletedModeForToday = (modeValue) => {
    const isBlitz = modeValue === 'blitz';
    const resultsKey = isBlitz ? BLITZ_RESULTS_KEY : DAILY_RESULTS_KEY;
    const dateKey = isBlitz ? BLITZ_DATE_KEY : DAILY_DATE_KEY;
    const savedResults = localStorage.getItem(resultsKey);
    const savedDate = localStorage.getItem(dateKey);
    const today = normalizeDateString(getTodayDate());
    return !!savedResults && normalizeDateString(savedDate) === today;
  };

  const modeIsUnlocked = (modeValue, completion = modeCompletion) => {
    return modeValue === 'blitz' ? completion.blitz : completion.daily;
  };

  const pickInitialMode = (preferredMode, completion) => {
    if (modeIsUnlocked(preferredMode, completion)) return preferredMode;
    if (completion.daily) return 'daily';
    if (completion.blitz) return 'blitz';
    return 'daily';
  };
  
  useEffect(() => {
    const storedMode = localStorage.getItem(LEADERBOARD_MODE_KEY);
    const preferredMode = storedMode === 'blitz' ? 'blitz' : 'daily';
    const completion = {
      daily: hasCompletedModeForToday('daily'),
      blitz: hasCompletedModeForToday('blitz')
    };

    setModeCompletion(completion);
    setMode(pickInitialMode(preferredMode, completion));
    setIsModeReady(true);

    const hasSeenBreakdownHint = localStorage.getItem(BREAKDOWN_HINT_SEEN_KEY) === 'true';
    if (!hasSeenBreakdownHint) {
      setShowBreakdownHint(true);
      localStorage.setItem(BREAKDOWN_HINT_SEEN_KEY, 'true');
    }
  }, []);

  useEffect(() => {
    if (!isModeReady) return;

    const storedPlayerId = localStorage.getItem('scraple_player_id');
    setPlayerId(storedPlayerId);

    const completion = {
      daily: hasCompletedModeForToday('daily'),
      blitz: hasCompletedModeForToday('blitz')
    };
    setModeCompletion(completion);

    const modeIsCompleted = modeIsUnlocked(mode, completion);
    setHasSubmittedScore(modeIsCompleted);

    if (!modeIsCompleted) {
      setLeaderboard(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    fetchLeaderboard(storedPlayerId, mode);
  }, [mode, isModeReady]);

  const getModeEndpoints = (modeValue) => ({
    leaderboard: modeValue === 'blitz' ? '/api/blitz/leaderboard' : '/api/leaderboard',
    wordBreakdown: modeValue === 'blitz' ? '/api/blitz/leaderboard/word-breakdown' : '/api/leaderboard/word-breakdown'
  });
  
  const fetchLeaderboard = async (id, modeValue = mode) => {
    const requestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = requestId;

    setIsLoading(true);
    setError(null);
    
    try {
      const { leaderboard } = getModeEndpoints(modeValue);
      const response = await fetch(`${leaderboard}${id ? `?playerId=${id}` : ''}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch leaderboard: ${response.status}`);
      }
      
      const data = await response.json();
      if (fetchRequestIdRef.current !== requestId) return;
      setLeaderboard(data);
    } catch (error) {
      if (fetchRequestIdRef.current !== requestId) return;
      console.error('Error fetching leaderboard:', error);
      setError('Failed to load leaderboard. Please try again.');
    } finally {
      if (fetchRequestIdRef.current !== requestId) return;
      setIsLoading(false);
    }
  };
  
  const handleRefresh = () => {
    if (!modeIsUnlocked(mode)) return;
    setExpandedEntryId(null);
    setWordBreakdownsByPlayer({});
    setBreakdownLoadingByPlayer({});
    setBreakdownErrorByPlayer({});
    fetchLeaderboard(playerId, mode);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    if (!modeIsUnlocked(nextMode)) return;
    localStorage.setItem(LEADERBOARD_MODE_KEY, nextMode);
    setLeaderboard(null);
    setError(null);
    setExpandedEntryId(null);
    setWordBreakdownsByPlayer({});
    setBreakdownLoadingByPlayer({});
    setBreakdownErrorByPlayer({});
    setMode(nextMode);
  };

  const fetchWordBreakdownForPlayer = async (entry) => {
    const targetPlayerId = entry?.playerId;
    if (!targetPlayerId) return;

    setBreakdownLoadingByPlayer((prev) => ({ ...prev, [targetPlayerId]: true }));
    setBreakdownErrorByPlayer((prev) => ({ ...prev, [targetPlayerId]: '' }));

    try {
      const { wordBreakdown } = getModeEndpoints(mode);
      const params = new URLSearchParams({ playerId: targetPlayerId });
      if (mode === 'blitz' && entry?.gameState?.puzzleId) {
        params.set('puzzleId', entry.gameState.puzzleId);
      }

      const response = await fetch(`${wordBreakdown}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch word breakdown: ${response.status}`);
      }

      const data = await response.json();
      setWordBreakdownsByPlayer((prev) => ({
        ...prev,
        [targetPlayerId]: Array.isArray(data.words) ? data.words : []
      }));
    } catch (breakdownError) {
      console.error('Error fetching word breakdown for leaderboard entry:', breakdownError);
      setBreakdownErrorByPlayer((prev) => ({
        ...prev,
        [targetPlayerId]: 'Failed to load this board breakdown. Try again.'
      }));
    } finally {
      setBreakdownLoadingByPlayer((prev) => ({ ...prev, [targetPlayerId]: false }));
    }
  };

  const handleBoardToggle = (entry) => {
    const targetPlayerId = entry?.playerId;
    if (!targetPlayerId) return;

    const isExpanded = expandedEntryId === targetPlayerId;
    if (isExpanded) {
      setExpandedEntryId(null);
      return;
    }

    setExpandedEntryId(targetPlayerId);

    const hasExistingBreakdown = Array.isArray(wordBreakdownsByPlayer[targetPlayerId]);
    const isAlreadyLoading = Boolean(breakdownLoadingByPlayer[targetPlayerId]);
    if (!hasExistingBreakdown && !isAlreadyLoading) {
      fetchWordBreakdownForPlayer(entry);
    }
  };
  
  // If the user hasn't submitted their score, show a message with total scores
  if (!hasSubmittedScore) {
    return (
      <div className={styles.leaderboardContainer}>
        <div className={styles.leaderboardHeader}>
          <h3>{mode === 'blitz' ? 'Blitz Leaderboard' : "Today's Leaderboard"}</h3>
          <div className={styles.headerControlsRow}>
            <div className={styles.modeToggle}>
              <button
                className={`${styles.modeButton} ${mode === 'daily' ? styles.activeMode : ''} ${!modeCompletion.daily ? styles.lockedMode : ''}`}
                onClick={() => handleModeChange('daily')}
                disabled={!modeCompletion.daily}
              >
                Daily
              </button>
              <button
                className={`${styles.modeButton} ${mode === 'blitz' ? styles.activeMode : ''} ${!modeCompletion.blitz ? styles.lockedMode : ''}`}
                onClick={() => handleModeChange('blitz')}
                disabled={!modeCompletion.blitz}
              >
                Blitz
              </button>
            </div>
            <div className={styles.totalPlayers}></div>
            <div></div>
          </div>
        </div>
        
        <div className={styles.emptyMessage}>
          {mode === 'blitz'
            ? 'Complete Blitz mode to unlock the Blitz leaderboard.'
            : 'Complete Daily mode to unlock today\'s Daily leaderboard.'}
        </div>
      </div>
    );
  }
  
  // Function to render a simplified board
  const renderMiniBoard = (gameState) => {
    if (!gameState || !gameState.placedTiles || !gameState.bonusTilePositions) {
      return <div className={styles.noBoard}>No board data</div>;
    }
    
    const boardSize = 5;
    const board = Array(boardSize).fill().map(() => Array(boardSize).fill(null));
    
    // Fill the board with placed tiles
    Object.entries(gameState.placedTiles).forEach(([position, letter]) => {
      const [row, col] = position.split('-').map(Number);
      if (row >= 0 && row < boardSize && col >= 0 && col < boardSize) {
        board[row][col] = letter;
      }
    });
    
    return (
      <div className={styles.miniBoard}>
        {board.map((row, rowIndex) => (
          <div key={`row-${rowIndex}`} className={styles.miniBoardRow}>
            {row.map((cell, colIndex) => {
              // Determine if this cell has a bonus
              let bonusClass = '';
              const position = `${rowIndex}-${colIndex}`;
              
              // Check each bonus type
              Object.entries(gameState.bonusTilePositions).forEach(([type, [bRow, bCol]]) => {
                if (bRow === rowIndex && bCol === colIndex) {
                  switch (type) {
                    case 'DOUBLE_LETTER':
                      bonusClass = styles.doubleLetter;
                      break;
                    case 'TRIPLE_LETTER':
                      bonusClass = styles.tripleLetter;
                      break;
                    case 'DOUBLE_WORD':
                      bonusClass = styles.doubleWord;
                      break;
                    case 'TRIPLE_WORD':
                      bonusClass = styles.tripleWord;
                      break;
                  }
                }
              });
              
              return (
                <div 
                  key={`cell-${rowIndex}-${colIndex}`} 
                  className={`${styles.miniBoardCell} ${bonusClass}`}
                >
                  {cell ? cell.letter : ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };
  
  if (isLoading) {
    return (
      <div className={styles.leaderboardContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Loading leaderboard...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={styles.leaderboardContainer}>
        <div className={styles.errorMessage}>{error}</div>
        <button className={styles.refreshButton} onClick={handleRefresh}>
          <IoMdRefresh /> Try Again
        </button>
      </div>
    );
  }
  
  if (!leaderboard || !leaderboard.scores || leaderboard.scores.length === 0) {
    return (
      <div className={styles.leaderboardContainer}>
        <div className={styles.emptyMessage}>
          No scores submitted yet today. Be the first!
        </div>
      </div>
    );
  }
  
  // Check if the player has submitted a score and has a rank
  const hasPlayerRank = leaderboard.playerInfo && 
                        leaderboard.playerInfo.rank !== null && 
                        leaderboard.playerInfo.rank !== undefined;
  
  return (
    <div className={styles.leaderboardContainer}>
      <div className={styles.leaderboardHeader}>
          <h3>{mode === 'blitz' ? 'Blitz Leaderboard' : "Today's Leaderboard"}</h3>
          <div className={styles.headerControlsRow}>
            <div className={styles.modeToggle}>
              <button
                className={`${styles.modeButton} ${mode === 'daily' ? styles.activeMode : ''} ${!modeCompletion.daily ? styles.lockedMode : ''}`}
                onClick={() => handleModeChange('daily')}
                disabled={!modeCompletion.daily}
              >
                Daily
              </button>
              <button
                className={`${styles.modeButton} ${mode === 'blitz' ? styles.activeMode : ''} ${!modeCompletion.blitz ? styles.lockedMode : ''}`}
                onClick={() => handleModeChange('blitz')}
                disabled={!modeCompletion.blitz}
              >
                Blitz
              </button>
            </div>
            <div className={styles.totalPlayers}>
              {leaderboard.totalPlayers} {leaderboard.totalPlayers === 1 ? 'player' : 'players'} today
            </div>
            <button className={styles.refreshButton} onClick={handleRefresh}>
              <IoMdRefresh />
            </button>
          </div>
      </div>
      
      {hasPlayerRank ? (
        <div className={styles.playerInfo}>
          <div className={styles.playerRank}>
            Your Rank: <span>{leaderboard.playerInfo.rank}</span> of {leaderboard.totalPlayers}
          </div>
          <div className={styles.playerPercentile}>
            Better than <span>{leaderboard.playerInfo.percentile}%</span> of players
          </div>
        </div>
      ) : (
        <div className={styles.noSubmissionMessage}>
          Submit your score to see your ranking!
        </div>
      )}

      {showBreakdownHint && (
        <div className={styles.breakdownHint}>
          <span className={styles.breakdownHintStar}>★</span>
          <span>New! Click a board to see the breakdown</span>
        </div>
      )}
      
      <div className={styles.leaderboardList}>
        <div className={styles.leaderboardListHeader}>
          <div className={styles.rankColumn}>Rank</div>
          <div className={styles.identityColumn}>Player</div>
          <div className={styles.scoreColumn}>Score</div>
          <div className={styles.boardColumn}>Board</div>
        </div>
        
        {leaderboard.scores.map((entry) => {
          const isExpanded = expandedEntryId === entry.playerId;
          const isLoadingBreakdown = Boolean(breakdownLoadingByPlayer[entry.playerId]);
          const breakdownError = breakdownErrorByPlayer[entry.playerId];
          const words = Array.isArray(wordBreakdownsByPlayer[entry.playerId])
            ? wordBreakdownsByPlayer[entry.playerId]
            : [];

          return (
            <div key={entry.playerId} className={styles.entryWrapper}>
              <div 
                className={`${styles.leaderboardEntry} ${entry.isCurrentPlayer ? styles.currentPlayer : ''}`}
              >
                <div className={styles.rankColumn}>
                  {entry.rank}
                  {entry.rank <= 3 && (
                    <span className={styles.medal}>
                      {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}
                    </span>
                  )}
                </div>
                <div className={styles.identityColumn}>
                  {entry.nickname ? (
                    <>
                      <div className={styles.identityLine}>
                        <span
                          className={styles.nicknameBadge}
                          style={getNicknameBadgeStyle(entry.playerHash || getPlayerHash(entry.playerId))}
                        >
                          {entry.nickname}
                        </span>
                      </div>
                      {Number(entry.streak) > 1 && (
                        <div className={styles.identityLine}>
                          <span className={styles.streakBadge}>
                            <span className={styles.streakEmoji}>🔥</span>
                            <span className={styles.streakValue}>{entry.streak}</span>
                          </span>
                        </div>
                      )}
                      <div className={styles.identityLine}>
                        <span className={styles.hashTag}>#{entry.playerHash || getPlayerHash(entry.playerId)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={styles.identityLine}>
                        <span className={styles.hashTag}>#{entry.playerHash || getPlayerHash(entry.playerId)}</span>
                      </div>
                      {Number(entry.streak) > 1 && (
                        <div className={styles.identityLine}>
                          <span className={styles.streakBadge}>
                            <span className={styles.streakEmoji}>🔥</span>
                            <span className={styles.streakValue}>{entry.streak}</span>
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className={styles.scoreColumn}>{entry.score}</div>
                <div className={styles.boardColumn}>
                  <button
                    type="button"
                    className={`${styles.boardToggleButton} ${isExpanded ? styles.boardToggleActive : ''}`}
                    onClick={() => handleBoardToggle(entry)}
                    aria-expanded={isExpanded}
                    aria-label={`Toggle board breakdown for rank ${entry.rank}`}
                  >
                    {renderMiniBoard(entry.gameState)}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className={styles.breakdownRow}>
                  <div className={styles.breakdownPanel}>
                    <div className={styles.breakdownTitle}>
                      Work Breakdown for {entry.nickname ? entry.nickname : `#${entry.playerHash || getPlayerHash(entry.playerId)}`}
                    </div>
                    {isLoadingBreakdown && (
                      <div className={styles.breakdownLoading}>Loading definitions and usage stats...</div>
                    )}
                    {!isLoadingBreakdown && breakdownError && (
                      <div className={styles.breakdownLoading}>{breakdownError}</div>
                    )}
                    {!isLoadingBreakdown && !breakdownError && words.length === 0 && (
                      <div className={styles.breakdownLoading}>This player did not create any words.</div>
                    )}
                    {!isLoadingBreakdown && !breakdownError && words.length > 0 && (
                      <ul className={styles.breakdownList}>
                        {words.map((wordResult, index) => (
                          <li
                            key={`${entry.playerId}-${wordResult.word}-${index}`}
                            className={`${styles.breakdownItem} ${wordResult.valid ? styles.validWord : styles.invalidWord}`}
                          >
                            <div className={styles.breakdownTopRow}>
                              <div className={styles.wordText}>{wordResult.word}</div>
                              <div className={styles.wordTopRight}>
                                <div className={styles.wordScore}>
                                  {wordResult.score >= 0 ? '+' : ''}{wordResult.score}
                                </div>
                                {Array.isArray(wordResult.usedBonusTypes) && wordResult.usedBonusTypes.length > 0 && (
                                  <div className={styles.bonusTileIcons}>
                                    {wordResult.usedBonusTypes.map((bonusType) => (
                                      <span key={`${entry.playerId}-${wordResult.word}-${bonusType}`} className={`${styles.bonusTileIcon} ${styles[`bonus${bonusType}`]}`}>
                                        {bonusTileLabels[bonusType] || bonusType}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            {wordResult.bonusPraise && (
                              <div className={styles.bonusPraise}>
                                <span className={styles.praiseIcon}>★</span>
                                {wordResult.bonusPraise}
                              </div>
                            )}
                            <div className={styles.breakdownDefinition}>
                              {wordResult.definition
                                ? renderFormattedDefinition(wordResult.definition, styles)
                                : (wordResult.valid ? 'Definition unavailable.' : 'Not a valid dictionary word.')}
                            </div>
                            <div className={styles.breakdownMeta}>
                              {wordResult.playedByOthersCount === null
                                ? 'Usage stats loading...'
                                : `${wordResult.playedByOthersCount} other player${wordResult.playedByOthersCount === 1 ? '' : 's'} used this word today`}
                            </div>
                            <div className={styles.breakdownMetaSecondary}>
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LeaderboardPopup; 
