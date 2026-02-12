'use client';

import React from 'react';
import { FiSun, FiMoon } from 'react-icons/fi';
import { useTheme } from '../contexts/ThemeContext';
import styles from './ThemeToggle.module.scss';

const ThemeToggle = ({ variant = 'icon' }) => {
  const { isDarkTheme, toggleTheme } = useTheme();

  if (variant === 'slider') {
    return (
      <button
        className={styles.themeSliderToggle}
        onClick={toggleTheme}
        aria-label={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        <span className={styles.themeSliderLabel}>
          <FiSun />
          Light
        </span>
        <span className={`${styles.themeSliderTrack} ${isDarkTheme ? styles.themeSliderTrackDark : ''}`}>
          <span className={styles.themeSliderThumb} />
        </span>
        <span className={styles.themeSliderLabel}>
          <FiMoon />
          Dark
        </span>
      </button>
    );
  }

  return (
    <button 
      className={styles.themeToggle} 
      onClick={toggleTheme}
      aria-label={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDarkTheme ? (
        <FiSun className={styles.icon} />
      ) : (
        <FiMoon className={styles.icon} />
      )}
    </button>
  );
};

export default ThemeToggle;
