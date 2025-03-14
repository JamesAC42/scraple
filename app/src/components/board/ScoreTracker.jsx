import React from 'react';
import styles from './ScoreTracker.module.scss';

const ScoreTracker = ({ currentScore, words }) => {
  // If no words are provided, show a message
  if (!words || words.length === 0) {
    return (
      <div className={styles.scoreTracker}>
        <div className={styles.scoreHeader}>
          <h3>Current Score: <span className={styles.scoreValue}>0</span></h3>
        </div>
        <div className={styles.noWords}>
          <p>Place tiles to form words</p>
        </div>
      </div>
    );
  }

  // Calculate total score
  const totalScore = words.reduce((sum, word) => sum + word.score, 0);

  return (
    <div className={styles.scoreTracker}>
      <div className={styles.scoreHeader}>
        <h3>Current Score: <span className={totalScore >= 0 ? styles.positiveScore : styles.negativeScore}>{totalScore}</span></h3>
      </div>
      <div className={styles.wordsContainer}>
        {words.map((wordResult, index) => (
          <div key={index} className={`${styles.wordItem} ${wordResult.valid ? styles.validWord : styles.invalidWord}`}>
            <span className={styles.wordText}>{wordResult.word}</span>
            <span className={styles.wordScore}>
              {wordResult.score >= 0 ? '+' : ''}{wordResult.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScoreTracker; 