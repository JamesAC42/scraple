'use client';

import { useState, useEffect } from 'react';
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

  const LEADERBOARD_MODE_KEY = 'scraple_leaderboard_mode';
  const DAILY_RESULTS_KEY = 'scraple_game_results';
  const BLITZ_RESULTS_KEY = 'scraple_blitz_game_results';
  const DAILY_DATE_KEY = 'scraple_game_date';
  const BLITZ_DATE_KEY = 'scraple_blitz_game_date';

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
  }, []);

  useEffect(() => {
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
  }, [mode]);

  const getModeEndpoints = (modeValue) => ({
    leaderboard: modeValue === 'blitz' ? '/api/blitz/leaderboard' : '/api/leaderboard'
  });
  
  const fetchLeaderboard = async (id, modeValue = mode) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { leaderboard } = getModeEndpoints(modeValue);
      const response = await fetch(`${leaderboard}${id ? `?playerId=${id}` : ''}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch leaderboard: ${response.status}`);
      }
      
      const data = await response.json();
      setLeaderboard(data);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      setError('Failed to load leaderboard. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleRefresh = () => {
    if (!modeIsUnlocked(mode)) return;
    fetchLeaderboard(playerId, mode);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    if (!modeIsUnlocked(nextMode)) return;
    localStorage.setItem(LEADERBOARD_MODE_KEY, nextMode);
    setLeaderboard(null);
    setError(null);
    setMode(nextMode);
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
      
      <div className={styles.leaderboardList}>
        <div className={styles.leaderboardListHeader}>
          <div className={styles.rankColumn}>Rank</div>
          <div className={styles.identityColumn}>Player</div>
          <div className={styles.scoreColumn}>Score</div>
          <div className={styles.boardColumn}>Board</div>
        </div>
        
        {leaderboard.scores.map((entry) => (
          <div 
            key={entry.playerId} 
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
              {renderMiniBoard(entry.gameState)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LeaderboardPopup; 
