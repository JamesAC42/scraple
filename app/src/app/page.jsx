'use client';

import styles from "../styles/pages/page.module.scss";
import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { IoMdHelpCircleOutline, IoMdInformationCircleOutline, IoMdTrophy, IoMdFlash, IoMdCalendar } from "react-icons/io";
import Board from "@/components/board/Board";
import Tile from "@/components/board/Tile";
import TileContainer from "@/components/board/TileContainer";
import { LiaUndoAltSolid } from "react-icons/lia";
import { IoCheckmark } from "react-icons/io5";
import { IoMdShuffle } from "react-icons/io";
import { IoShareSocialOutline } from "react-icons/io5";
import { 
  DndContext, 
  DragOverlay, 
  pointerWithin, 
  defaultDropAnimationSideEffects
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';

import { usePopup } from "@/contexts/PopupContext";
import Confirm from "@/components/board/Confirm";
import finishGame from "@/lib/finishGame";
import calculateCurrentScore from "@/lib/calculateCurrentScore";
import ScoreTracker from "@/components/board/ScoreTracker";

// Letter points mapping
const letterPoints = {
  'A': 1, 'E': 1, 'I': 1, 'L': 1, 'N': 1, 'O': 1, 'R': 1, 'S': 1, 'T': 1, 'U': 1,
  'D': 2, 'G': 2,
  'B': 3, 'C': 3, 'M': 3, 'P': 3,
  'F': 4, 'H': 4, 'V': 4, 'W': 4, 'Y': 4,
  'K': 5,
  'J': 8, 'X': 8,
  'Q': 10, 'Z': 10,
  '': 0 // Blank tile
};

// Local storage keys
const STORAGE_KEY = 'scraple_game_state';
const GAME_DATE_KEY = 'scraple_game_date';
const GAME_RESULTS_KEY = 'scraple_game_results';
const PLAYER_ID_KEY = 'scraple_player_id';
const HELP_SEEN_KEY = 'scraple_help_seen'; // New key for tracking if help popup has been seen
const DATA_VERSION_KEY = 'scraple_data_version'; // New key for tracking data version
const BLITZ_STORAGE_KEY = 'scraple_blitz_game_state';
const BLITZ_GAME_DATE_KEY = 'scraple_blitz_game_date';
const BLITZ_GAME_RESULTS_KEY = 'scraple_blitz_game_results';
const BLITZ_PUZZLE_ID_KEY = 'scraple_blitz_puzzle_id';
const BLITZ_START_TIME_KEY = 'scraple_blitz_start_time';
const LEADERBOARD_MODE_KEY = 'scraple_leaderboard_mode';

const BLITZ_DURATION_SECONDS = 60;

// Current data version - increment this when making breaking changes to the data structure
const CURRENT_DATA_VERSION = '1.0.0';

// Function to get emoji and descriptive word based on score
const getScoreRating = (score) => {
  if (score < 50) return { emoji: "🙂", description: "You tried" };
  if (score < 80) return { emoji: "👍", description: "Good start" };
  if (score < 110) return { emoji: "👏", description: "Great" };
  if (score < 140) return { emoji: "🔥", description: "Excellent" };
  if (score < 170) return { emoji: "💯", description: "Outstanding" };
  return { emoji: "🏆", description: "Exceptional" };
};

// Format date as YYYY-MM-DD in Eastern Time
const getFormattedDate = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York'
  }).format(new Date());
};

// Format date for display (Month Day, Year)
const getDisplayDate = () => {
  // Create date in Eastern Time
  const date = new Date();
  const options = { 
    timeZone: 'America/New_York',
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  };
  return date.toLocaleString('en-US', options);
};

const formatBlitzTime = (seconds) => {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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

export default function Home() {
  // Initialize letters state with empty array
  const [letters, setLetters] = useState([]);
  const [placedTiles, setPlacedTiles] = useState({});
  const [activeTile, setActiveTile] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [usedTileIds, setUsedTileIds] = useState([]);
  const [invalidPlacement, setInvalidPlacement] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingFromBoard, setIsDraggingFromBoard] = useState(false);
  const [originalPosition, setOriginalPosition] = useState(null);
  const [bonusTilePositions, setBonusTilePositions] = useState({});
  const [displayDate, setDisplayDate] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [gameMode, setGameMode] = useState('daily');
  const [puzzleId, setPuzzleId] = useState(null);
  const [blitzTimeLeft, setBlitzTimeLeft] = useState(BLITZ_DURATION_SECONDS);

  // New state variables for game status
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [gameResults, setGameResults] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  
  // New state variables for leaderboard
  const [leaderboardInfo, setLeaderboardInfo] = useState(null);
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [isFetchingWordBreakdown, setIsFetchingWordBreakdown] = useState(false);
  const [playerId, setPlayerId] = useState(null);
  const [dailyCompleted, setDailyCompleted] = useState(false);
  const [blitzCompleted, setBlitzCompleted] = useState(false);
  const [wordBreakdown, setWordBreakdown] = useState([]);
  const [hasRequestedWordBreakdown, setHasRequestedWordBreakdown] = useState(false);

  const [showFinishPopup, setShowFinishPopup] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [validationError, setValidationError] = useState('');
  const textAreaRef = useRef(null);
  const blitzTimeoutRef = useRef(null);
  const blitzAutoSubmitRef = useRef(false);

  const { setActivePopup } = usePopup();
  
  // Audio refs for sound effects
  const suctionSoundRef = useRef(null);
  const clackSoundRef = useRef(null);
  
  const [currentScore, setCurrentScore] = useState(0);
  const [currentWords, setCurrentWords] = useState([]);
  const isBlitzMode = gameMode === 'blitz';

  const checkDailyCompleted = () => {
    if (typeof window === 'undefined') return false;
    const savedResults = localStorage.getItem(GAME_RESULTS_KEY);
    const savedDate = localStorage.getItem(GAME_DATE_KEY);
    const today = getFormattedDate();
    return !!savedResults && savedDate === today;
  };

  const checkBlitzCompleted = () => {
    if (typeof window === 'undefined') return false;
    const savedResults = localStorage.getItem(BLITZ_GAME_RESULTS_KEY);
    const savedDate = localStorage.getItem(BLITZ_GAME_DATE_KEY);
    const today = getFormattedDate();
    return !!savedResults && savedDate === today;
  };

  const getModeStorage = (mode) => {
    const isBlitz = mode === 'blitz';
    return {
      storageKey: isBlitz ? BLITZ_STORAGE_KEY : STORAGE_KEY,
      dateKey: isBlitz ? BLITZ_GAME_DATE_KEY : GAME_DATE_KEY,
      resultsKey: isBlitz ? BLITZ_GAME_RESULTS_KEY : GAME_RESULTS_KEY,
      puzzleIdKey: isBlitz ? BLITZ_PUZZLE_ID_KEY : null,
      startTimeKey: isBlitz ? BLITZ_START_TIME_KEY : null
    };
  };

  const getModeEndpoints = (mode) => {
    const isBlitz = mode === 'blitz';
    return {
      puzzleEndpoint: isBlitz ? '/api/blitz-puzzle' : '/api/daily-puzzle',
      leaderboardSubmit: isBlitz ? '/api/blitz/leaderboard/submit' : '/api/leaderboard/submit',
      leaderboardQuery: isBlitz ? '/api/blitz/leaderboard' : '/api/leaderboard',
      leaderboardTotal: isBlitz ? '/api/blitz/leaderboard/total' : '/api/leaderboard/total',
      wordBreakdownEndpoint: isBlitz ? '/api/blitz/leaderboard/word-breakdown' : '/api/leaderboard/word-breakdown'
    };
  };
  
  // Fetch puzzle from the server based on mode
  const fetchPuzzle = async (mode) => {
    try {
      setIsLoading(true);
      const { puzzleEndpoint } = getModeEndpoints(mode);
      const response = await fetch(puzzleEndpoint);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch puzzle: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching puzzle:', error);
      // Show an error message to the user
      alert('Failed to load the puzzle. Please try refreshing the page.');
      return null;
    } finally {
      setIsLoading(false);
    }
  };
  
  // Load daily game state from localStorage
  const loadDailyGameState = async () => {
    if (typeof window !== 'undefined') {
      try {
        setPuzzleId(null);
        const savedState = localStorage.getItem(STORAGE_KEY);
        const savedDate = localStorage.getItem(GAME_DATE_KEY);
        const savedResults = localStorage.getItem(GAME_RESULTS_KEY);
        const savedVersion = localStorage.getItem(DATA_VERSION_KEY);
        
        // Check if we need to migrate data due to version mismatch
        if (savedVersion !== CURRENT_DATA_VERSION) {
          console.log(`Data version mismatch: ${savedVersion} vs ${CURRENT_DATA_VERSION}`);
          
          // For now, just clear the data and start fresh
          // In the future, you could add migration logic here
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(GAME_DATE_KEY);
          localStorage.removeItem(GAME_RESULTS_KEY);
          
          // Set the new version
          localStorage.setItem(DATA_VERSION_KEY, CURRENT_DATA_VERSION);
          
          // Continue with a fresh game
          const dailyPuzzle = await fetchPuzzle('daily');
          if (dailyPuzzle) {
            setLetters(dailyPuzzle.letters);
            setBonusTilePositions(dailyPuzzle.bonusTilePositions);
            setDisplayDate(dailyPuzzle.displayDate);
            setPlacedTiles({});
            setUsedTileIds([]);
            setIsGameFinished(false);
            setGameResults(null);
            setWordBreakdown([]);
            setHasRequestedWordBreakdown(false);
            
            // Save the new state with the server's date
            const newGameState = {
              letters: dailyPuzzle.letters,
              placedTiles: {},
              usedTileIds: [],
              isGameFinished: false,
              date: dailyPuzzle.date,
              bonusTilePositions: dailyPuzzle.bonusTilePositions,
              displayDate: dailyPuzzle.displayDate
            };
            
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newGameState));
            localStorage.setItem(GAME_DATE_KEY, dailyPuzzle.date);
            
            return true;
          }
          return false;
        }
        
        // Always fetch the current puzzle from the server to get the correct date
        const dailyPuzzle = await fetchPuzzle('daily');
        
        if (!dailyPuzzle) {
          console.error("Failed to fetch daily puzzle");
          setIsLoading(false);
          return false;
        }
        
        // Use the server's date as the source of truth
        const serverDate = dailyPuzzle.date;
        console.log("Server date:", serverDate, "Saved date:", savedDate);
        
        // Check for potentially corrupted data
        let isDataCorrupted = false;
        
        if (savedState) {
          try {
            const parsedState = JSON.parse(savedState);
            
            // Check if the saved state has all required properties
            if (!parsedState.letters || !parsedState.bonusTilePositions || !parsedState.date) {
              console.warn("Saved game state is missing required properties");
              isDataCorrupted = true;
            }
            
            // Check if the saved date matches the date in the saved state
            if (savedDate !== parsedState.date) {
              console.warn("Date mismatch between GAME_DATE_KEY and saved state");
              isDataCorrupted = true;
            }
          } catch (parseError) {
            console.error("Error parsing saved game state:", parseError);
            isDataCorrupted = true;
          }
        }
        
        // If data is corrupted, clear it and use the new puzzle
        if (isDataCorrupted) {
          console.log("Detected corrupted data, clearing localStorage and using new puzzle");
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(GAME_DATE_KEY);
          localStorage.removeItem(GAME_RESULTS_KEY);
          
          // Set up new game state with the server's puzzle
          setLetters(dailyPuzzle.letters);
          setBonusTilePositions(dailyPuzzle.bonusTilePositions);
          setDisplayDate(dailyPuzzle.displayDate);
          setPlacedTiles({});
          setUsedTileIds([]);
          setIsGameFinished(false);
          setGameResults(null);
          setWordBreakdown([]);
          setHasRequestedWordBreakdown(false);
          
          // Save the new state with the server's date
          const newGameState = {
            letters: dailyPuzzle.letters,
            placedTiles: {},
            usedTileIds: [],
            isGameFinished: false,
            date: serverDate,
            bonusTilePositions: dailyPuzzle.bonusTilePositions,
            displayDate: dailyPuzzle.displayDate
          };
          
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newGameState));
          localStorage.setItem(GAME_DATE_KEY, serverDate);
          
          return true;
        }
        
        // If it's a new day or no saved state, use the new puzzle
        if (savedDate !== serverDate || !savedState) {
          console.log("New day or no saved state, using new puzzle");
          setLetters(dailyPuzzle.letters);
          setBonusTilePositions(dailyPuzzle.bonusTilePositions);
          setDisplayDate(dailyPuzzle.displayDate);
          setPlacedTiles({});
          setUsedTileIds([]);
          setIsGameFinished(false);
          setGameResults(null);
          
          // Clear results from localStorage
          localStorage.removeItem(GAME_RESULTS_KEY);
          
          // Save the new state with the server's date
          const newGameState = {
            letters: dailyPuzzle.letters,
            placedTiles: {},
            usedTileIds: [],
            isGameFinished: false,
            date: serverDate,
            bonusTilePositions: dailyPuzzle.bonusTilePositions,
            displayDate: dailyPuzzle.displayDate
          };
          
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newGameState));
          localStorage.setItem(GAME_DATE_KEY, serverDate);
          
          return true;
        }
        
        // If we have a saved state for the same day, use it
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          
          setLetters(parsedState.letters || []);
          setPlacedTiles(parsedState.placedTiles || {});
          setUsedTileIds(parsedState.usedTileIds || []);
          setWordBreakdown([]);
          setHasRequestedWordBreakdown(false);
          
          // Explicitly check for isGameFinished
          const gameFinished = parsedState.isGameFinished === true;
          setIsGameFinished(gameFinished);
          setDailyCompleted(!!savedResults && savedDate === parsedState.date);
          
          setBonusTilePositions(parsedState.bonusTilePositions || {});
          setDisplayDate(parsedState.displayDate || '');
          
          // Load game results if they exist
          if (savedResults) {
            const parsedResults = JSON.parse(savedResults);
            setGameResults(parsedResults);
          } else if (gameFinished) {
            // If the game is finished but we don't have results, something went wrong
            console.warn("Game is marked as finished but no results found");
          }
          
          // Make sure to set loading to false when loading from localStorage
          setIsLoading(false);
          
          return true;
        }
      } catch (error) {
        console.error("Error loading game state:", error);
        // Make sure to set loading to false on error
        setIsLoading(false);
      }
    }
    return false;
  };

  // Load blitz game state from localStorage
  const loadBlitzGameState = async ({ forceNewPuzzle = false } = {}) => {
    if (typeof window !== 'undefined') {
      if (!checkDailyCompleted()) {
        setValidationError('Finish the daily puzzle to unlock Blitz Mode.');
        return false;
      }
      if (forceNewPuzzle && checkBlitzCompleted()) {
        forceNewPuzzle = false;
      }
      const { storageKey, dateKey, resultsKey, puzzleIdKey, startTimeKey } = getModeStorage('blitz');
      try {
        const savedState = localStorage.getItem(storageKey);
        const savedResults = localStorage.getItem(resultsKey);
        const savedPuzzleId = puzzleIdKey ? localStorage.getItem(puzzleIdKey) : null;
        const savedStartTime = startTimeKey ? localStorage.getItem(startTimeKey) : null;

        if (!forceNewPuzzle && savedState) {
          const parsedState = JSON.parse(savedState);
          const today = getFormattedDate();
          if (parsedState.date && parsedState.date !== today) {
            forceNewPuzzle = true;
          } else {
          setLetters(parsedState.letters || []);
          setPlacedTiles(parsedState.placedTiles || {});
          setUsedTileIds(parsedState.usedTileIds || []);
          blitzAutoSubmitRef.current = false;

          const gameFinished = parsedState.isGameFinished === true;
          setIsGameFinished(gameFinished);

          setBonusTilePositions(parsedState.bonusTilePositions || {});
          setDisplayDate(parsedState.displayDate || '');
          setPuzzleId(parsedState.puzzleId || savedPuzzleId || null);

          if (savedResults) {
            setGameResults(JSON.parse(savedResults));
            setBlitzCompleted(true);
          } else if (gameFinished && playerId) {
            try {
              const { leaderboardQuery } = getModeEndpoints('blitz');
              const leaderboardResponse = await fetch(`${leaderboardQuery}?playerId=${playerId}`);
              if (leaderboardResponse.ok) {
                const leaderboardData = await leaderboardResponse.json();
                const playerEntry = Array.isArray(leaderboardData?.scores)
                  ? leaderboardData.scores.find((entry) => entry.playerId === playerId)
                  : null;
                const persistedGameState = playerEntry?.gameState || null;

                if (persistedGameState && typeof persistedGameState.totalScore === 'number') {
                  const recoveredResults = {
                    totalScore: persistedGameState.totalScore,
                    words: Array.isArray(persistedGameState.words) ? persistedGameState.words : []
                  };
                  setGameResults(recoveredResults);
                  localStorage.setItem(resultsKey, JSON.stringify(recoveredResults));
                  setBlitzCompleted(true);
                } else if (leaderboardData?.playerInfo && typeof leaderboardData.playerInfo.score === 'number') {
                  const recoveredResults = {
                    totalScore: leaderboardData.playerInfo.score,
                    words: []
                  };
                  setGameResults(recoveredResults);
                  localStorage.setItem(resultsKey, JSON.stringify(recoveredResults));
                  setBlitzCompleted(true);
                } else {
                  setGameResults(null);
                  setBlitzCompleted(false);
                }
              } else {
                setGameResults(null);
                setBlitzCompleted(false);
              }
            } catch (recoveryError) {
              console.error('Error recovering blitz results from leaderboard:', recoveryError);
              setGameResults(null);
              setBlitzCompleted(false);
            }
          } else {
            setGameResults(null);
            setBlitzCompleted(false);
          }

          if (savedStartTime) {
            const elapsedSeconds = Math.floor((Date.now() - Number(savedStartTime)) / 1000);
            const remaining = Math.max(0, BLITZ_DURATION_SECONDS - elapsedSeconds);
            setBlitzTimeLeft(remaining);
          } else {
            setBlitzTimeLeft(BLITZ_DURATION_SECONDS);
            if (startTimeKey) {
              localStorage.setItem(startTimeKey, Date.now().toString());
            }
          }

          setIsLoading(false);
          return true;
          }
        }

        const blitzPuzzle = await fetchPuzzle('blitz');
        if (blitzPuzzle) {
          setLetters(blitzPuzzle.letters);
          setBonusTilePositions(blitzPuzzle.bonusTilePositions);
          setDisplayDate(blitzPuzzle.displayDate);
          setPlacedTiles({});
          setUsedTileIds([]);
          setIsGameFinished(false);
          setGameResults(null);
          setLeaderboardInfo(null);
          setWordBreakdown([]);
          setHasRequestedWordBreakdown(false);
          setPuzzleId(blitzPuzzle.puzzleId || null);
          setBlitzTimeLeft(BLITZ_DURATION_SECONDS);
          blitzAutoSubmitRef.current = false;
          setBlitzCompleted(false);

          const newGameState = {
            letters: blitzPuzzle.letters,
            placedTiles: {},
            usedTileIds: [],
            isGameFinished: false,
            date: blitzPuzzle.date,
            bonusTilePositions: blitzPuzzle.bonusTilePositions,
            displayDate: blitzPuzzle.displayDate,
            puzzleId: blitzPuzzle.puzzleId || null
          };

          localStorage.setItem(storageKey, JSON.stringify(newGameState));
          localStorage.setItem(dateKey, blitzPuzzle.date);
          localStorage.removeItem(resultsKey);
          if (puzzleIdKey && blitzPuzzle.puzzleId) {
            localStorage.setItem(puzzleIdKey, blitzPuzzle.puzzleId);
          }

          if (startTimeKey) {
            localStorage.setItem(startTimeKey, Date.now().toString());
          }

          return true;
        }
      } catch (error) {
        console.error("Error loading blitz game state:", error);
        setIsLoading(false);
      }
    }
    return false;
  };

  const loadGameState = async (mode, options = {}) => {
    if (mode === 'blitz') {
      return loadBlitzGameState(options);
    }
    return loadDailyGameState();
  };

  // Reset the game state
  const resetGame = async () => {
    if (isBlitzMode) {
      await loadBlitzGameState({ forceNewPuzzle: !checkBlitzCompleted() });
      return;
    }
    // Fetch the current day's puzzle again
    const dailyPuzzle = await fetchPuzzle('daily');
    
    if (dailyPuzzle) {
      // Reset all game state
      setLetters(dailyPuzzle.letters);
      setBonusTilePositions(dailyPuzzle.bonusTilePositions);
      setDisplayDate(dailyPuzzle.displayDate);
      setPlacedTiles({});
      setUsedTileIds([]);
      setInvalidPlacement(false);
      setIsGameFinished(false);
      setGameResults(null);
      setLeaderboardInfo(null);
      setWordBreakdown([]);
      setHasRequestedWordBreakdown(false);
      
      // Clear results from localStorage
      if (typeof window !== 'undefined') {
        localStorage.removeItem(GAME_RESULTS_KEY);
      }
      
      // Save the new state with the server's date
      const newGameState = {
        letters: dailyPuzzle.letters,
        placedTiles: {},
        usedTileIds: [],
        isGameFinished: false,
        date: dailyPuzzle.date, // Use the server's date
        bonusTilePositions: dailyPuzzle.bonusTilePositions,
        displayDate: dailyPuzzle.displayDate
      };
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newGameState));
      localStorage.setItem(GAME_DATE_KEY, dailyPuzzle.date);
    }
  };

  const switchGameMode = async (mode, { forceNewPuzzle = false } = {}) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LEADERBOARD_MODE_KEY, mode);
    }
    if (mode === 'blitz' && !checkDailyCompleted()) {
      setValidationError('Finish the daily puzzle to unlock Blitz Mode.');
      return;
    }
    setGameMode(mode);
    setLeaderboardInfo(null);
    setWordBreakdown([]);
    setHasRequestedWordBreakdown(false);
    setValidationError('');
    setInvalidPlacement(false);
    await loadGameState(mode, { forceNewPuzzle });
  };

  const forceDailyMode = async () => {
    setGameMode('daily');
    setLeaderboardInfo(null);
    setWordBreakdown([]);
    setHasRequestedWordBreakdown(false);
    setValidationError('');
    setInvalidPlacement(false);
    await loadGameState('daily');
  };
  
  // Add structured data for SEO
  useEffect(() => {
    // Add JSON-LD structured data for better SEO
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.innerHTML = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Game',
      'name': 'Scraple',
      'description': 'A free word game combining elements of Scrabble and Wordle. Challenge your vocabulary, form words on a board, and earn points.',
      'genre': 'Word Game',
      'gameItem': [
        {
          '@type': 'Thing',
          'name': 'Letter Tiles'
        }
      ],
      'audience': {
        '@type': 'Audience',
        'audienceType': 'Word game enthusiasts'
      },
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD',
        'availability': 'https://schema.org/InStock'
      }
    });
    document.head.appendChild(script);
    
    // Initialize audio elements
    suctionSoundRef.current = new Audio('/sounds/suction.mp3');
    clackSoundRef.current = new Audio('/sounds/clack.mp3');
    
    return () => {
      document.head.removeChild(script);
    };
  }, []);
  
  // Load game state on initial render
  useEffect(() => {
    const initializeGame = async () => {
      try {
        setGameMode('daily');
        setDailyCompleted(checkDailyCompleted());
        setBlitzCompleted(checkBlitzCompleted());
        const hasLoadedState = await loadGameState('daily');
        
        // If no saved state was loaded, the loadGameState function will have fetched a new puzzle
        if (!hasLoadedState) {
          const puzzle = await fetchPuzzle('daily');
          if (puzzle) {
            setLetters(puzzle.letters);
            setBonusTilePositions(puzzle.bonusTilePositions);
            setDisplayDate(puzzle.displayDate);
          } else {
            // If we couldn't fetch a puzzle, still set loading to false
            setIsLoading(false);
          }
        }
      } catch (error) {
        console.error("Error initializing game:", error);
        // Make sure to set loading to false on any error
        setIsLoading(false);
      }
    };
    
    initializeGame();
  }, []);
  
  // Save game state whenever relevant state changes
  useEffect(() => {
    if (letters.length > 0) {
      saveGameState();
    }
  }, [letters, placedTiles, usedTileIds, isGameFinished, gameResults, bonusTilePositions, displayDate, gameMode, puzzleId]);
  
  const shuffleLetters = () => {
    // Don't allow shuffling if game is finished
    if (isGameFinished) return;
    
    // Create a new array for display order without modifying the original letters
    setLetters(prevLetters => {
      // Create a deep copy of the original letters
      const lettersCopy = JSON.parse(JSON.stringify(prevLetters));
      
      // Get indices of unused tiles
      const unusedIndices = [];
      for (let i = 0; i < lettersCopy.length; i++) {
        const tileId = `tile-${i}`;
        if (!usedTileIds.includes(tileId)) {
          unusedIndices.push(i);
        }
      }
      
      // Shuffle only the unused indices
      for (let i = unusedIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        // Swap the actual letter objects at these indices
        const temp = lettersCopy[unusedIndices[i]];
        lettersCopy[unusedIndices[i]] = lettersCopy[unusedIndices[j]];
        lettersCopy[unusedIndices[j]] = temp;
      }
      
      return lettersCopy;
    });
  };

  const handleDragStart = (event) => {
    // Don't allow dragging if game is finished
    if (isGameFinished) return;
    
    const { active } = event;
    
    // Check if we're dragging a tile from the board
    const isBoardTile = active.id.startsWith('placed-');
    
    if (isBoardTile) {
      // Extract the original tile data from the placed tile
      const position = active.data.current?.position;
      if (position) {
        const cellKey = `${position.row}-${position.col}`;
        const tileData = placedTiles[cellKey];
        
        // Store the original position and tile data
        setOriginalPosition({ cellKey, tileData });
        
        // Set the active tile data
        setActiveTile(tileData);
        
        // We don't need to set activeId for board tiles since they don't have a corresponding rack ID
        setActiveId(null);
        
        // Set flag that we're dragging from board before removing the tile
        setIsDraggingFromBoard(true);
        
        // Remove the tile from its current position
        setPlacedTiles(prev => {
          const newPlacedTiles = { ...prev };
          delete newPlacedTiles[cellKey];
          return newPlacedTiles;
        });
      }
    } else {
      // Regular tile from the rack
      setActiveTile(active.data.current?.letter);
      setActiveId(active.id);
      setOriginalPosition(null); // No original position for rack tiles
    }
    
    setInvalidPlacement(false);
    setIsDragging(true);
    setValidationError(''); // Clear any validation errors when starting a new drag
    
    // Play suction sound when tile is picked up
    if (suctionSoundRef.current) {
      suctionSoundRef.current.currentTime = 0.1;
      suctionSoundRef.current.play().catch(e => console.log("Audio play error:", e));
    }
  };

  const handleDragEnd = (event) => {
    // Don't process drag end if game is finished
    if (isGameFinished) return;
    
    const { active, over } = event;
    
    // Reset the dragging from board flag
    setIsDraggingFromBoard(false);
    
    if (!over) {
      // Dropped outside any droppable area
      if (originalPosition) {
        // If this was a tile from the board, return it to its original position
        setPlacedTiles(prev => ({
          ...prev,
          [originalPosition.cellKey]: originalPosition.tileData
        }));
      }
      
      // Reset states
      setActiveTile(null);
      setActiveId(null);
      setOriginalPosition(null);
      setInvalidPlacement(false);
      setIsDragging(false);
      return;
    }
    
    // Check if dropped on tile container (to return the tile to the rack)
    if (over.id === 'tile-container') {
      // If this was a tile from the board, we need to add it back to available tiles
      if (active.id.startsWith('placed-')) {
        // Generate a new unique tile ID that doesn't exist in usedTileIds
        let newIndex = letters.length;
        let newTileId = `tile-${newIndex}`;
        
        // Make sure the new ID is unique
        while (usedTileIds.includes(newTileId)) {
          newIndex++;
          newTileId = `tile-${newIndex}`;
        }
        
        // Add the tile to the end of the letters array with the new index
        const newTile = { ...activeTile };
        setLetters(prev => [...prev, newTile]);
      }
      
      // Reset active tile state
      setActiveTile(null);
      setActiveId(null);
      setOriginalPosition(null);
      setInvalidPlacement(false);
      setIsDragging(false);
      return;
    }
    
    if (over.id.startsWith('cell-')) {
      const tileData = activeTile;
      const cellPosition = over.data.current?.position;
      
      if (cellPosition && tileData) {
        const { row, col } = cellPosition;
        const cellKey = `${row}-${col}`;
        
        // Check if the cell already has a tile
        if (placedTiles[cellKey]) {
          // If invalid placement, return the tile to its original position if it was from the board
          if (originalPosition) {
            setPlacedTiles(prev => ({
              ...prev,
              [originalPosition.cellKey]: originalPosition.tileData
            }));
          }
          
          setInvalidPlacement(true);
          setActiveTile(null);
          setActiveId(null);
          setOriginalPosition(null);
          setIsDragging(false);
          return;
        }
        
        // Valid placement - update placed tiles
        // No need to check for adjacency anymore
        setPlacedTiles(prev => ({
          ...prev,
          [cellKey]: tileData
        }));
        
        // If this is a new tile from the rack (not a moved tile), track it as used
        if (activeId && activeId.startsWith('tile-')) {
          setUsedTileIds(prev => [...prev, activeId]);
        }
        
        // Play clack sound when tile is placed
        if (clackSoundRef.current) {
          clackSoundRef.current.currentTime = 0.2; // Start 100ms into the sound
          clackSoundRef.current.play().catch(e => console.log("Audio play error:", e));
        }
      }
    }
    
    setActiveTile(null);
    setActiveId(null);
    setOriginalPosition(null);
    setIsDragging(false);
  };

  // Custom drop animation to make it smoother
  const dropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

  // Check if all tiles form a valid pattern (connected horizontally or vertically)
  const validateTilePlacement = () => {
    // If no tiles are placed, return false
    if (Object.keys(placedTiles).length === 0) {
      setValidationError("Please place at least one tile on the board.");
      return false;
    }
    
    // Create a grid representation of placed tiles
    const grid = {};
    const positions = Object.keys(placedTiles).map(pos => {
      const [row, col] = pos.split('-').map(Number);
      grid[pos] = { row, col };
      return { row, col, pos };
    });
    
    // If only one tile is placed, it's invalid - we need at least two tiles
    if (positions.length === 1) {
      setValidationError("Please place at least two tiles on the board.");
      return false;
    }
    
    // Check if all tiles are connected
    const visited = new Set();
    
    // DFS to find connected tiles
    const dfs = (pos) => {
      if (visited.has(pos)) return;
      visited.add(pos);
      
      const [row, col] = pos.split('-').map(Number);
      
      // Check all four adjacent positions
      const adjacentPositions = [
        `${row-1}-${col}`, // up
        `${row}-${col+1}`, // right
        `${row+1}-${col}`, // down
        `${row}-${col-1}`  // left
      ];
      
      for (const adjPos of adjacentPositions) {
        if (grid[adjPos]) {
          dfs(adjPos);
        }
      }
    };
    
    // Start DFS from the first tile
    dfs(positions[0].pos);
    
    // If all tiles are visited, they are connected
    if (visited.size === positions.length) {
      return true;
    }
    
    setValidationError("All tiles must be connected horizontally or vertically.");
    return false;
  };

  // Generate or retrieve player ID
  useEffect(() => {
    // Check if player ID exists in localStorage
    let storedPlayerId = localStorage.getItem(PLAYER_ID_KEY);
    
    // If not, generate a new one
    if (!storedPlayerId) {
      storedPlayerId = 'player_' + Math.random().toString(36).substring(2, 15) + 
                       Math.random().toString(36).substring(2, 15);
      localStorage.setItem(PLAYER_ID_KEY, storedPlayerId);
    }
    
    setPlayerId(storedPlayerId);
  }, []);
  
  // Submit score to leaderboard
  const submitScoreToLeaderboard = async (results, mode = gameMode) => {
    if (!playerId || !results) return null;
    
    setIsSubmittingScore(true);
    
    try {
      const { leaderboardSubmit } = getModeEndpoints(mode);
      const { dateKey } = getModeStorage(mode);
      // Get the current date from localStorage to ensure consistency
      const currentDate = localStorage.getItem(dateKey) || getFormattedDate();
      
      const gameState = {
        placedTiles,
        bonusTilePositions,
        date: currentDate, // Use the date from localStorage
        puzzleId: mode === 'blitz' ? puzzleId : undefined
      };
      
      const response = await fetch(leaderboardSubmit, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          score: results.totalScore,
          gameState,
          playerId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to submit score: ${response.status}`);
      }
      
      const data = await response.json();
      setLeaderboardInfo(data);
      return data;
    } catch (error) {
      console.error('Error submitting score:', error);
      return null;
    } finally {
      setIsSubmittingScore(false);
    }
  };

  const fetchWordBreakdown = async (mode = gameMode) => {
    if (!playerId || !isGameFinished || !gameResults) return;

    setIsFetchingWordBreakdown(true);
    setHasRequestedWordBreakdown(true);
    try {
      const { wordBreakdownEndpoint } = getModeEndpoints(mode);
      const params = new URLSearchParams({ playerId });
      if (mode === 'blitz' && puzzleId) {
        params.set('puzzleId', puzzleId);
      }

      const response = await fetch(`${wordBreakdownEndpoint}?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 404) {
          setWordBreakdown([]);
          return;
        }
        throw new Error(`Failed to fetch word breakdown: ${response.status}`);
      }

      const data = await response.json();
      setWordBreakdown(Array.isArray(data.words) ? data.words : []);
    } catch (error) {
      console.error('Error fetching word breakdown:', error);
      setWordBreakdown([]);
    } finally {
      setIsFetchingWordBreakdown(false);
    }
  };
  
  const finalizeGame = async ({ skipValidation = false } = {}) => {
    if (!skipValidation) {
      // Validate tile placement before proceeding
      if (!validateTilePlacement()) {
        setShowFinishPopup(false);
        return;
      }
    }
    
    setIsCalculating(true);
    
    try {
      // Calculate the game results
      const results = await finishGame({
        placedTiles,
        bonusTilePositions,
        letterPoints
      });
      
      // Update state with results
      setGameResults(results);
      setIsGameFinished(true);
      setWordBreakdown([]);
      setHasRequestedWordBreakdown(false);
      setShowFinishPopup(false);
      
      // Submit score to leaderboard
      const submitResult = await submitScoreToLeaderboard(results, gameMode);
      if (submitResult) {
        await fetchWordBreakdown(gameMode);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(LEADERBOARD_MODE_KEY, gameMode);
      }
      if (gameMode === 'daily') {
        setDailyCompleted(true);
      } else if (gameMode === 'blitz') {
        setBlitzCompleted(true);
      }
      
      const { storageKey, dateKey, resultsKey, puzzleIdKey } = getModeStorage(gameMode);
      // Get the current date from localStorage to ensure consistency
      const currentDate = localStorage.getItem(dateKey) || getFormattedDate();
      
      // Force an immediate save of the game state with the updated isGameFinished flag
      const gameState = {
        letters,
        placedTiles,
        usedTileIds,
        isGameFinished: true, // Explicitly set to true
        date: currentDate, // Use the date from localStorage
        bonusTilePositions,
        displayDate,
        puzzleId: isBlitzMode ? puzzleId : undefined
      };
      
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(gameState));
        localStorage.setItem(dateKey, currentDate);
        localStorage.setItem(resultsKey, JSON.stringify(results));
        if (puzzleIdKey && puzzleId) {
          localStorage.setItem(puzzleIdKey, puzzleId);
        }
      }
    } catch (error) {
      console.error("Error calculating game results:", error);
      alert("There was an error calculating your score. Please try again.");
    } finally {
      setIsCalculating(false);
    }
  };

  const handleConfirm = async () => {
    await finalizeGame();
  };

  // Handle sharing game results
  const handleShare = async () => {
    if (!gameResults) return;
    
    // Create share text
    const date = getDisplayDate();
    const modeLabel = isBlitzMode ? 'Blitz' : '';
    
    const { emoji, description } = getScoreRating(gameResults.totalScore);
    
    // Format text differently for web share vs clipboard
    const isWebShare = navigator.share && window.location.hostname !== 'localhost';
    
    // For clipboard, we'll use more spacing to make it readable in plain text
    let shareText = `Scraple ${modeLabel ? `${modeLabel} ` : ''}${date}: ${gameResults.totalScore} points ${emoji}\n`;
    shareText += `${description}!\n\n`;
    
    // Add valid words
    //const validWords = gameResults.words.filter(word => word.valid);
    //if (validWords.length > 0) {
    //  shareText += `Words: ${validWords.map(w => w.word.toUpperCase()).join(', ')}\n\n`;
    //}
    
    // Add URL with proper spacing
    shareText += `Play today's puzzle at: ${window.location.origin}`;
    
    // Try to use Web Share API if available and not in development
    if (isWebShare) {
      try {
        await navigator.share({
          title: 'My Scraple Score',
          text: shareText,
          url: window.location.href
        });
      } catch (error) {
        console.error('Error sharing:', error);
        // Fall back to clipboard if sharing fails
        copyToClipboard(shareText);
      }
    } else {
      // Fallback to clipboard
      copyToClipboard(shareText);
    }
  };
  
  // Helper function to copy text to clipboard
  const copyToClipboard = (text) => {
    // Set the textarea value to our text
    if (textAreaRef.current) {
      textAreaRef.current.value = text;
      textAreaRef.current.select();
      
      try {
        // Try the modern clipboard API first
        navigator.clipboard.writeText(text).then(
          () => {
            setShareMessage('Results copied to clipboard!');
            setTimeout(() => setShareMessage(''), 3000);
          },
          (err) => {
            // If clipboard API fails, try document.execCommand
            console.error('Clipboard API failed:', err);
            fallbackCopyToClipboard();
          }
        );
      } catch (err) {
        // If clipboard API is not available, try document.execCommand
        console.error('Clipboard API not available:', err);
        fallbackCopyToClipboard();
      }
    }
  };
  
  // Fallback copy method using execCommand
  const fallbackCopyToClipboard = () => {
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        setShareMessage('Results copied to clipboard!');
      } else {
        setShareMessage('Failed to copy results. Please try again.');
      }
    } catch (err) {
      console.error('execCommand error:', err);
      setShareMessage('Failed to copy results. Please try again.');
    }
    
    // Clear message after 3 seconds
    setTimeout(() => {
      setShareMessage('');
    }, 3000);
  };
  
  // Calculate current score whenever placedTiles changes
  useEffect(() => {
    const updateCurrentScore = async () => {
      // Skip calculation if we're in the middle of dragging a tile from the board
      if (isDraggingFromBoard) {
        return;
      }
      
      // Only calculate if there are placed tiles and game is not finished
      if (Object.keys(placedTiles).length > 0 && !isGameFinished) {
        try {
          const results = await calculateCurrentScore({
            placedTiles,
            bonusTilePositions,
            letterPoints
          });
          
          setCurrentScore(results.totalScore);
          setCurrentWords(results.words);
        } catch (error) {
          console.error("Error calculating current score:", error);
        }
      } else {
        // Reset score if no tiles are placed
        setCurrentScore(0);
        setCurrentWords([]);
      }
    };
    
    updateCurrentScore();
  }, [placedTiles, bonusTilePositions, isGameFinished, isDraggingFromBoard]);

  // Blitz timer effect
  useEffect(() => {
    if (!isBlitzMode || isGameFinished) {
      if (blitzTimeoutRef.current) {
        clearInterval(blitzTimeoutRef.current);
        blitzTimeoutRef.current = null;
      }
      return;
    }
    
    if (!checkDailyCompleted()) {
      forceDailyMode();
      return;
    }

    const startTime = localStorage.getItem(BLITZ_START_TIME_KEY);
    if (!startTime) {
      return;
    }

    const tick = () => {
      const elapsedSeconds = Math.floor((Date.now() - Number(startTime)) / 1000);
      const remaining = Math.max(0, BLITZ_DURATION_SECONDS - elapsedSeconds);
      setBlitzTimeLeft(remaining);

      if (remaining <= 0 && !blitzAutoSubmitRef.current) {
        blitzAutoSubmitRef.current = true;
        finalizeGame({ skipValidation: true });
      }
    };

    tick();
    blitzTimeoutRef.current = setInterval(tick, 1000);

    return () => {
      if (blitzTimeoutRef.current) {
        clearInterval(blitzTimeoutRef.current);
        blitzTimeoutRef.current = null;
      }
    };
  }, [isBlitzMode, isGameFinished, gameMode]);
  
  // Add a new useEffect to fetch leaderboard info when the game is loaded as finished
  useEffect(() => {
    const fetchLeaderboardInfo = async () => {
      // Only fetch if the game is finished, we have results, and we have a playerId
      if (isGameFinished && gameResults && playerId) {
        
        try {
          // Check if we already have leaderboard info
          if (!leaderboardInfo) {
            setIsSubmittingScore(true);
            const { leaderboardQuery } = getModeEndpoints(gameMode);
            const response = await fetch(`${leaderboardQuery}?playerId=${playerId}`);
            
            if (!response.ok) {
              throw new Error(`Failed to fetch leaderboard: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Only update leaderboard info if we have player info
            if (data.playerInfo) {
              
              // Format the data to match the structure expected by the UI
              setLeaderboardInfo({
                rank: data.playerInfo.rank,
                totalScores: data.totalPlayers,
                percentile: data.playerInfo.percentile,
                isInTopTen: data.playerInfo.rank <= 10
              });
            }
          }
        } catch (error) {
          console.error("Error fetching leaderboard info:", error);
        } finally {
          setIsSubmittingScore(false);
        }
      }
    };
    
    fetchLeaderboardInfo();
  }, [isGameFinished, gameResults, playerId, leaderboardInfo, gameMode]);

  useEffect(() => {
    const recoverBlitzResults = async () => {
      if (!isBlitzMode || !isGameFinished || gameResults || !playerId) return;
      try {
        const { leaderboardQuery } = getModeEndpoints('blitz');
        const response = await fetch(`${leaderboardQuery}?playerId=${playerId}`);
        if (!response.ok) return;

        const data = await response.json();
        const playerEntry = Array.isArray(data?.scores)
          ? data.scores.find((entry) => entry.playerId === playerId)
          : null;
        const persistedGameState = playerEntry?.gameState || null;

        if (persistedGameState && typeof persistedGameState.totalScore === 'number') {
          const recoveredResults = {
            totalScore: persistedGameState.totalScore,
            words: Array.isArray(persistedGameState.words) ? persistedGameState.words : []
          };
          setGameResults(recoveredResults);
          localStorage.setItem(BLITZ_GAME_RESULTS_KEY, JSON.stringify(recoveredResults));
          setBlitzCompleted(true);
          return;
        }

        if (data?.playerInfo && typeof data.playerInfo.score === 'number') {
          const recoveredResults = {
            totalScore: data.playerInfo.score,
            words: []
          };
          setGameResults(recoveredResults);
          localStorage.setItem(BLITZ_GAME_RESULTS_KEY, JSON.stringify(recoveredResults));
          setBlitzCompleted(true);
        }
      } catch (error) {
        console.error('Error recovering blitz results:', error);
      }
    };

    recoverBlitzResults();
  }, [isBlitzMode, isGameFinished, gameResults, playerId]);

  useEffect(() => {
    if (!isGameFinished || !gameResults || !playerId) return;
    if (!leaderboardInfo) return;
    if (isFetchingWordBreakdown) return;
    if (hasRequestedWordBreakdown || wordBreakdown.length > 0) return;
    fetchWordBreakdown(gameMode);
  }, [isGameFinished, gameResults, playerId, leaderboardInfo, gameMode, puzzleId, wordBreakdown.length, isFetchingWordBreakdown, hasRequestedWordBreakdown]);
  
  // Add a new useEffect to show the help popup on first visit
  useEffect(() => {
    // Check if the user has seen the help popup before
    if (typeof window !== 'undefined' && !isLoading) {
      const hasSeenHelp = localStorage.getItem(HELP_SEEN_KEY);
      
      if (!hasSeenHelp) {
        // Show the help popup
        setActivePopup("help");
        
        // Mark that the user has seen the help popup
        localStorage.setItem(HELP_SEEN_KEY, 'true');
      }
    }
  }, [isLoading, setActivePopup]); // Depend on isLoading to ensure the game is loaded first
  
  // Save game state to localStorage
  const saveGameState = () => {
    if (typeof window !== 'undefined') {
      console.log("Saving game state, isGameFinished:", isGameFinished);
      
      const { storageKey, dateKey, resultsKey, puzzleIdKey } = getModeStorage(gameMode);
      // Get the current date from localStorage to ensure consistency
      const currentDate = localStorage.getItem(dateKey) || getFormattedDate();
      
      const gameState = {
        letters,
        placedTiles,
        usedTileIds,
        isGameFinished,
        date: currentDate, // Use the date from localStorage or fallback to current date
        bonusTilePositions,
        displayDate,
        puzzleId: isBlitzMode ? puzzleId : undefined
      };
      
      localStorage.setItem(storageKey, JSON.stringify(gameState));
      localStorage.setItem(dateKey, currentDate);
      if (puzzleIdKey && puzzleId) {
        localStorage.setItem(puzzleIdKey, puzzleId);
      }
      
      // Save game results if they exist
      if (gameResults) {
        console.log("Saving game results");
        localStorage.setItem(resultsKey, JSON.stringify(gameResults));
      }
    }
  };

  const fallbackWordBreakdown = (Array.isArray(leaderboardInfo?.words) ? leaderboardInfo.words : (Array.isArray(gameResults?.words) ? gameResults.words : [])).map((wordResult) => ({
    ...wordResult,
    definition: null,
    playedByOthersCount: null,
    averageScoreAmongPlayers: null,
    usedBonusTypes: [],
    bonusPraise: null,
    isHighScoringSpecial: wordResult.valid && wordResult.score > 50,
    isUniqueTodaySpecial: false,
    isSpecial: wordResult.valid && wordResult.score > 50
  }));
  const displayedWordBreakdown = wordBreakdown.length > 0 ? wordBreakdown : fallbackWordBreakdown;
  const hasSubmittedWords = Array.isArray(gameResults?.words) && gameResults.words.length > 0;
  
  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Loading today's puzzle...</p>
      </div>
    );
  }
  
  return (
    <DndContext
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToWindowEdges]}
    >
      {
        showFinishPopup && (
          <Confirm 
            message={isBlitzMode ? "Submit your Blitz board now?" : "Are you sure you're done? You get one submission per day!"} 
            confirm={handleConfirm} 
            cancel={() => setShowFinishPopup(false)} />
        )
      }
      <div className="page">
        <div className="content-container">
          
          <div className={styles.gameHeader}>
            <Image 
              src="/images/logo.png" 
              alt="Scraple Logo" 
              width={434} 
              height={434} 
              priority
            />
            <div className={styles.gameHeaderText}>
              <h1>Scraple</h1>
              <p>{displayDate}</p>
              {isBlitzMode && (
                <span className={styles.modeBadge}>Blitz Mode</span>
              )}
            </div>

            <div className={styles.gameHeaderButtons}>
              {isBlitzMode ? (
                <button 
                  className={styles.gameHeaderButton}
                  onClick={() => switchGameMode('daily')}
                  title="Back to Daily Mode"
                >
                  <IoMdCalendar />
                </button>
              ) : (
                dailyCompleted && (
                  <button 
                    className={styles.gameHeaderButton}
                    onClick={() => switchGameMode('blitz')}
                    title={blitzCompleted ? "Review Blitz Mode" : "Play Blitz Mode"}
                  >
                    <IoMdFlash />
                  </button>
                )
              )}
              <button 
                className={styles.gameHeaderButton}
                onClick={() => {
                  localStorage.setItem(LEADERBOARD_MODE_KEY, gameMode);
                  setActivePopup("leaderboard");
                }}
              >
                <IoMdTrophy />
              </button>
              <button 
                className={styles.gameHeaderButton}
                onClick={() => setActivePopup("help")}
              >
                <IoMdHelpCircleOutline />
              </button>
              <button 
                className={styles.gameHeaderButton}
                onClick={() => setActivePopup("info")}
              >
                <IoMdInformationCircleOutline />
              </button>
            </div>
          </div>

          <div className={styles.gameState}>
            {invalidPlacement && (
              <div className={styles.errorMessage}>
                This cell already contains a tile
              </div>
            )}
            {validationError && (
              <div className={styles.errorMessage}>
                {validationError}
              </div>
            )}
            {isCalculating && (
              <div className={styles.calculatingMessage}>
                Calculating your score...
              </div>
            )}
            {isSubmittingScore && (
              <div className={styles.calculatingMessage}>
                Submitting your score...
              </div>
            )}
          </div>

          <div className={styles.scoreTrackerContainer}>
            {isBlitzMode && !isGameFinished && (
              <div className={styles.blitzTimerStrip}>
                ⚡ {formatBlitzTime(blitzTimeLeft)} ⚡
              </div>
            )}
            {/* Add ScoreTracker component above the board */}
            {!isGameFinished && (
              <ScoreTracker 
                currentScore={currentScore} 
                words={currentWords} 
              />
            )}
          </div>

          <div className={styles.boardContainer}>
            <Board 
              size={5} 
              bonusTilePositions={bonusTilePositions} 
              placedTiles={placedTiles} 
              isDragging={isDragging}
            />

            <div className={styles.wideControlsContainer}>
              <div
                onClick={!isGameFinished ? () => setShowFinishPopup(true) : undefined}
                className={`${styles.finishButton} ${isGameFinished ? styles.disabledButton : ''}`}>
                <IoCheckmark /> 
                <div className={styles.buttonLabel}>
                  {isGameFinished ? "Finished" : "Finish"}
                </div>
              </div>
              <div
                onClick={resetGame}
                className={`${styles.resetButton} ${isGameFinished ? styles.disabledButton : ''}`}>
                <LiaUndoAltSolid /> 
                <div className={styles.buttonLabel}>
                  Reset
                </div>
              </div>
            </div>
          </div>
          
          {isGameFinished && !isCalculating && (
            <div className={styles.gameFinishedMessage}>
              {isBlitzMode ? "Blitz complete! Nice run." : "Game completed! Come back tomorrow for a new challenge."}
            </div>
          )}

          {isGameFinished && !isCalculating && !isBlitzMode && (
            <div className={styles.blitzPrompt}>
              <div className={styles.blitzPromptText}>
                Want to try Blitz Mode? You have 60 seconds.
              </div>
              <button
                className={styles.blitzButton}
                onClick={() => switchGameMode('blitz')}
              >
                {blitzCompleted ? 'Review Game' : 'Play Blitz Mode'}
              </button>
            </div>
          )}

          {/* Game Results Section */}
          {isGameFinished && gameResults && (
            <div className={styles.resultsContainer}>
              <h2 className={styles.resultsTitle}>
                {isBlitzMode ? 'Blitz Results' : 'Game Results'}
              </h2>
              <div className={styles.totalScore}>
                Total Score: <span className={gameResults.totalScore >= 0 ? styles.positiveScore : styles.negativeScore}>
                  {gameResults.totalScore}
                </span>
                <span className={styles.scoreRating}>
                  {getScoreRating(gameResults.totalScore).emoji} <strong>{getScoreRating(gameResults.totalScore).description}</strong>
                </span>
              </div>
              
              {/* Leaderboard Info */}
              {leaderboardInfo && (
                <div className={styles.leaderboardInfo}>
                  <div className={styles.leaderboardRank}>
                    {leaderboardInfo.isInTopTen ? (
                      <div className={styles.topTenBadge}>
                        🏆 You're in the top 10! Rank: <strong>{leaderboardInfo.rank}</strong>
                      </div>
                    ) : (
                      <div>
                        Your rank: <strong>{leaderboardInfo.rank}</strong> of {leaderboardInfo.totalScores}
                      </div>
                    )}
                  </div>
                  <div className={styles.leaderboardPercentile}>
                    Better than <strong>{leaderboardInfo.percentile}%</strong> of players today
                  </div>
                  <button 
                    className={styles.viewLeaderboardButton}
                    onClick={() => {
                      localStorage.setItem(LEADERBOARD_MODE_KEY, gameMode);
                      setActivePopup("leaderboard");
                    }}
                  >
                    <IoMdTrophy /> View Full Leaderboard
                  </button>
                </div>
              )}
              
              <div className={styles.shareContainer}>
                <button 
                  className={styles.shareButton}
                  onClick={handleShare}
                >
                  <IoShareSocialOutline /> 
                  {window.location.hostname === 'localhost' 
                    ? 'Copy Results to Clipboard' 
                    : 'Share Results'}
                </button>
                {shareMessage && (
                  <div className={styles.shareMessage}>
                    {shareMessage}
                  </div>
                )}
              </div>
              
              <div className={styles.wordsContainer}>
                <h3>Word Breakdown</h3>
                {isFetchingWordBreakdown && (
                  <div className={styles.wordsLoading}>Loading definitions and usage stats...</div>
                )}
                {!isFetchingWordBreakdown && !hasSubmittedWords && (
                  <div className={styles.wordsLoading}>You did not create any words.</div>
                )}
                {!isFetchingWordBreakdown && hasSubmittedWords && wordBreakdown.length === 0 && (
                  <div className={styles.wordsLoading}>Showing your scores while detailed stats load.</div>
                )}
                <ul className={styles.breakdownList}>
                  {displayedWordBreakdown.map((wordResult, index) => (
                    <li
                      key={`${wordResult.word}-${index}`}
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
                                <span key={`${wordResult.word}-${bonusType}`} className={`${styles.bonusTileIcon} ${styles[`bonus${bonusType}`]}`}>
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
              </div>
            </div>
          )}

          <div className={styles.tileContainer}>
            <TileContainer 
              letters={letters} 
              onShuffle={!isGameFinished ? shuffleLetters : undefined} 
              usedTileIds={usedTileIds}
            />
          </div>

          <DragOverlay 
            dropAnimation={dropAnimation}
            zIndex={1000}
          >
            {activeTile ? (
              <Tile 
                letter={activeTile} 
                id={activeId ? `overlay-${activeId}` : `overlay-dragging`} 
              />
            ) : null}
          </DragOverlay>

          <div className={styles.smallControlsContainer}>
            <div
              onClick={!isGameFinished ? () => setShowFinishPopup(true) : undefined}
              className={`${styles.finishButton} ${isGameFinished ? styles.disabledButton : ''}`}>
              <IoCheckmark /> 
              <div className={styles.buttonLabel}>
              {isGameFinished ? "Finished" : "Finish"}
              </div>
            </div>
            <div
              onClick={!isGameFinished ? shuffleLetters : undefined}
              className={`${styles.shuffleButton} ${isGameFinished ? styles.disabledButton : ''}`}>
              <IoMdShuffle /> 
              <div className={styles.buttonLabel}>
                Shuffle Tiles
              </div>
            </div>
            <div
              onClick={resetGame}
              className={`${styles.resetButton} ${isGameFinished ? styles.disabledButton : ''}`}>
              <LiaUndoAltSolid /> 
              <div className={styles.buttonLabel}>
                Reset
              </div>
            </div>
          </div>
          
          {/* Reset all data button has been moved to the info popup */}
        </div>
      </div>
      {/* Hidden textarea for clipboard operations */}
      <textarea
        ref={textAreaRef}
        style={{ 
          position: 'absolute', 
          left: '-9999px', 
          top: 0,
          opacity: 0,
          height: 0
        }}
        aria-hidden="true"
      />
    </DndContext>
  );
}
