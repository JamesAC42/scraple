'use client';

import { useState, useEffect } from 'react';
import styles from './LeaderboardPopup.module.scss';
import { IoMdRefresh } from 'react-icons/io';

const LeaderboardPopup = ({ onClose }) => {
  const [leaderboard, setLeaderboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [hasSubmittedScore, setHasSubmittedScore] = useState(false);
  const [totalScores, setTotalScores] = useState(null);
  const [mode, setMode] = useState('daily');

  const LEADERBOARD_MODE_KEY = 'scraple_leaderboard_mode';
  const DAILY_RESULTS_KEY = 'scraple_game_results';
  const BLITZ_RESULTS_KEY = 'scraple_blitz_game_results';
  
  useEffect(() => {
    const storedMode = localStorage.getItem(LEADERBOARD_MODE_KEY);
    setMode(storedMode === 'blitz' ? 'blitz' : 'daily');
  }, []);

  useEffect(() => {
    // Check if the user has submitted their score
    const resultsKey = mode === 'blitz' ? BLITZ_RESULTS_KEY : DAILY_RESULTS_KEY;
    const gameResults = localStorage.getItem(resultsKey);
    setHasSubmittedScore(!!gameResults);
    
    // Get player ID from localStorage
    const storedPlayerId = localStorage.getItem('scraple_player_id');
    setPlayerId(storedPlayerId);
    
    if (!!gameResults) {
      fetchLeaderboard(storedPlayerId, mode);
    } else {
      // If user hasn't submitted a score, fetch just the total number of scores
      fetchTotalScores(mode);
    }
  }, [mode]);

  const getModeEndpoints = (modeValue) => ({
    leaderboard: modeValue === 'blitz' ? '/api/blitz/leaderboard' : '/api/leaderboard',
    total: modeValue === 'blitz' ? '/api/blitz/leaderboard/total' : '/api/leaderboard/total'
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
  
  const fetchTotalScores = async (modeValue = mode) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { total } = getModeEndpoints(modeValue);
      const response = await fetch(total);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch total scores: ${response.status}`);
      }
      
      const data = await response.json();
      setTotalScores(data.totalScores);
    } catch (error) {
      console.error('Error fetching total scores:', error);
      setError('Failed to load leaderboard data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleRefresh = () => {
    if (hasSubmittedScore) {
      fetchLeaderboard(playerId, mode);
    } else {
      fetchTotalScores(mode);
    }
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    localStorage.setItem(LEADERBOARD_MODE_KEY, nextMode);
    setLeaderboard(null);
    setTotalScores(null);
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
                className={`${styles.modeButton} ${mode === 'daily' ? styles.activeMode : ''}`}
                onClick={() => handleModeChange('daily')}
              >
                Daily
              </button>
              <button
                className={`${styles.modeButton} ${mode === 'blitz' ? styles.activeMode : ''}`}
                onClick={() => handleModeChange('blitz')}
              >
                Blitz
              </button>
            </div>
            <div className={styles.totalPlayers}>
              {(totalScores ?? 0)} {(totalScores ?? 0) === 1 ? 'player' : 'players'} today
            </div>
            <button className={styles.refreshButton} onClick={handleRefresh}>
              <IoMdRefresh />
            </button>
          </div>
        </div>
        
        {isLoading ? (
          <div className={styles.loadingSpinner}></div>
        ) : error ? (
          <div className={styles.errorMessage}>{error}</div>
        ) : (
          <div className={styles.emptyMessage}>
            Submit your game and see how you rank against {totalScores} other {totalScores === 1 ? 'player' : 'players'} today!
          </div>
        )}
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
                className={`${styles.modeButton} ${mode === 'daily' ? styles.activeMode : ''}`}
                onClick={() => handleModeChange('daily')}
              >
                Daily
              </button>
              <button
                className={`${styles.modeButton} ${mode === 'blitz' ? styles.activeMode : ''}`}
                onClick={() => handleModeChange('blitz')}
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
