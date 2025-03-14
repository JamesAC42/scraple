'use client';

import React, { useEffect } from 'react';
import ThemeProvider, { useTheme } from '../contexts/ThemeContext';
import ThemeToggle from './ThemeToggle';

// This component ensures the theme class is applied to the body
const ThemeApplier = ({ children }) => {
  const { isDarkTheme } = useTheme();
  
  useEffect(() => {
    if (isDarkTheme) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [isDarkTheme]);
  
  return <>{children}</>;
};

const ThemeWrapper = ({ children }) => {
  return (
    <ThemeProvider>
      <ThemeApplier>
        <div className="theme-toggle-container">
          <ThemeToggle />
        </div>
        {children}
      </ThemeApplier>
    </ThemeProvider>
  );
};

export default ThemeWrapper; 