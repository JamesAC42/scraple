'use client';

import styles from "../styles/pages/page.module.scss";
import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { IoMdHelpCircleOutline, IoMdInformationCircleOutline, IoMdTrophy, IoMdFlash, IoMdCalendar, IoMdPerson, IoMdMenu, IoMdClose } from "react-icons/io";
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
import NicknamePrompt from "@/components/NicknamePrompt";
import ThemeToggle from "@/components/ThemeToggle";
import {
  PLAYER_ID_KEY,
  hasDismissedNicknamePrompt,
  getStoredNickname,
  setStoredNickname,
  getNicknameBadgeStyle,
  getPlayerHash
} from "@/lib/nickname";
import { updateStreakOnPuzzleComplete } from "@/lib/streaks";
import { recordCompletedGameStats } from "@/lib/userStats";

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
const HELP_SEEN_KEY = 'scraple_help_seen'; // New key for tracking if help popup has been seen
const DATA_VERSION_KEY = 'scraple_data_version'; // New key for tracking data version
const BLITZ_STORAGE_KEY = 'scraple_blitz_game_state';
const BLITZ_GAME_DATE_KEY = 'scraple_blitz_game_date';
const BLITZ_GAME_RESULTS_KEY = 'scraple_blitz_game_results';
const BLITZ_PUZZLE_ID_KEY = 'scraple_blitz_puzzle_id';
const BLITZ_START_TIME_KEY = 'scraple_blitz_start_time';
const PRACTICE_STORAGE_KEY = 'scraple_practice_game_state';
const PRACTICE_GAME_DATE_KEY = 'scraple_practice_game_date';
const PRACTICE_GAME_RESULTS_KEY = 'scraple_practice_game_results';
const PRACTICE_PUZZLE_ID_KEY = 'scraple_practice_puzzle_id';
const PRACTICE_SHARE_IMAGE_DATE_KEY = 'scraple_practice_share_image_date';
const PRACTICE_SHARE_IMAGE_DATA_KEY = 'scraple_practice_share_image_data';
const LEADERBOARD_MODE_KEY = 'scraple_leaderboard_mode';
const SHARE_MODE_KEY = 'scraple_share_mode';
const PRACTICE_BOARD_QUERY_KEY = 'board';
const PRACTICE_MODE_QUERY_KEY = 'practice';
const PRACTICE_MODE_QUERY_VALUE = '1';
const SHARE_NEW_BADGE_EXPIRES_ON = '2026-02-14';

const BLITZ_DURATION_SECONDS = 60;
const COMMENT_MAX_LENGTH = 250;

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

const LETTER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BOARD_BONUS_ORDER = ['DOUBLE_LETTER', 'TRIPLE_LETTER', 'DOUBLE_WORD', 'TRIPLE_WORD'];

const toBase64Url = (raw) => btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const fromBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = normalized.length % 4 === 0 ? 0 : (4 - (normalized.length % 4));
  return atob(normalized + '='.repeat(padLen));
};

const encodeBoardPayload = ({ letters = [], bonusTilePositions = {} }) => {
  const counts = Array.from({ length: LETTER_ALPHABET.length }, () => 0);
  letters.forEach((entry) => {
    const letter = String(entry?.letter || '').toUpperCase();
    const idx = LETTER_ALPHABET.indexOf(letter);
    if (idx >= 0) {
      counts[idx] += 1;
    }
  });

  const countsStr = counts
    .map((count) => Math.max(0, Math.min(35, count)).toString(36))
    .join('');

  const bonusStr = BOARD_BONUS_ORDER.map((bonusType) => {
    const pos = bonusTilePositions?.[bonusType];
    if (!Array.isArray(pos) || pos.length < 2) return '0';
    const row = Math.max(0, Math.min(4, Number(pos[0]) || 0));
    const col = Math.max(0, Math.min(4, Number(pos[1]) || 0));
    return (row * 5 + col).toString(36);
  }).join('');

  return toBase64Url(`c1${countsStr}${bonusStr}`);
};

const decodeBoardPayload = (value) => {
  const decoded = fromBase64Url(value);
  if (!decoded.startsWith('c1')) {
    throw new Error('Invalid compact board payload format');
  }

  const payload = decoded.slice(2);
  if (payload.length < 30) {
    throw new Error('Compact board payload too short');
  }

  const countsStr = payload.slice(0, 26);
  const bonusStr = payload.slice(26, 30);

  const letters = [];
  countsStr.split('').forEach((char, index) => {
    const count = parseInt(char, 36);
    if (!Number.isFinite(count) || count <= 0) return;
    const letter = LETTER_ALPHABET[index];
    const points = letterPoints[letter];
    for (let i = 0; i < count; i += 1) {
      letters.push({ letter, points });
    }
  });

  const bonusTilePositions = {};
  BOARD_BONUS_ORDER.forEach((bonusType, index) => {
    const packed = parseInt(bonusStr[index], 36);
    if (!Number.isFinite(packed)) return;
    bonusTilePositions[bonusType] = [Math.floor(packed / 5), packed % 5];
  });

  return { letters, bonusTilePositions };
};

const normalizePracticeBoardPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.letters)) return null;
  if (!payload.bonusTilePositions || typeof payload.bonusTilePositions !== 'object') return null;

  return {
    letters: payload.letters,
    bonusTilePositions: payload.bonusTilePositions,
    displayDate: 'Practice Game',
    date: getFormattedDate(),
    puzzleId: typeof payload.puzzleId === 'string' ? payload.puzzleId : `practice-shared-${Date.now()}`
  };
};

const setPracticeQueryParams = ({ enabled, boardData = null }) => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (enabled) {
    url.searchParams.set(PRACTICE_MODE_QUERY_KEY, PRACTICE_MODE_QUERY_VALUE);
    if (boardData) {
      url.searchParams.set(PRACTICE_BOARD_QUERY_KEY, boardData);
    } else {
      url.searchParams.delete(PRACTICE_BOARD_QUERY_KEY);
    }
  } else {
    url.searchParams.delete(PRACTICE_MODE_QUERY_KEY);
    url.searchParams.delete(PRACTICE_BOARD_QUERY_KEY);
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', nextPath);
};

const clearPracticeShareImageCache = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PRACTICE_SHARE_IMAGE_DATE_KEY);
  localStorage.removeItem(PRACTICE_SHARE_IMAGE_DATA_KEY);
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

const getUsedBonusTypesForWord = (positions = [], bonusTilePositions = {}) => {
  const used = [];
  const checks = [
    ['DOUBLE_LETTER', bonusTilePositions.DOUBLE_LETTER],
    ['TRIPLE_LETTER', bonusTilePositions.TRIPLE_LETTER],
    ['DOUBLE_WORD', bonusTilePositions.DOUBLE_WORD],
    ['TRIPLE_WORD', bonusTilePositions.TRIPLE_WORD]
  ];

  checks.forEach(([type, pos]) => {
    if (!pos || pos.length < 2) return;
    const [targetRow, targetCol] = pos;
    const matches = positions.some((p) => p && p.row === targetRow && p.col === targetCol);
    if (matches) used.push(type);
  });

  return used;
};

const getBonusPraiseForWord = (score, usedBonusTypes, valid) => {
  if (!valid || !Array.isArray(usedBonusTypes) || usedBonusTypes.length === 0) return null;
  if (score >= 60) return 'Genius!';
  if (score >= 50) return 'Superb!';
  if (score >= 40) return 'Excellent!';
  if (score >= 30) return 'Great!';
  return null;
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
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [isFetchingComments, setIsFetchingComments] = useState(false);
  const [hasRequestedComments, setHasRequestedComments] = useState(false);
  const [botGamePreview, setBotGamePreview] = useState(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [commentInfo, setCommentInfo] = useState('');
  const [playerNickname, setPlayerNickname] = useState('');
  const [showNicknamePrompt, setShowNicknamePrompt] = useState(false);

  const [showFinishPopup, setShowFinishPopup] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [practiceBoardShareMessage, setPracticeBoardShareMessage] = useState('');
  const blitzTimeoutRef = useRef(null);
  const blitzAutoSubmitRef = useRef(false);
  const finalizeGameRef = useRef(null);
  const isModeSwitchingRef = useRef(false);

  const { setActivePopup } = usePopup();
  
  // Audio refs for sound effects
  const suctionSoundRef = useRef(null);
  const clackSoundRef = useRef(null);
  
  const [currentScore, setCurrentScore] = useState(0);
  const [currentWords, setCurrentWords] = useState([]);
  const isBlitzMode = gameMode === 'blitz';
  const isPracticeMode = gameMode === 'practice';
  const showShareNewBadge = getFormattedDate() <= SHARE_NEW_BADGE_EXPIRES_ON;

  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const onResize = () => {
      if (window.innerWidth >= 700) {
        setIsMobileSidebarOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobileSidebarOpen]);

  const checkDailyCompleted = () => {
    if (typeof window === 'undefined') return false;
    const savedResults = localStorage.getItem(GAME_RESULTS_KEY);
    const savedDate = localStorage.getItem(GAME_DATE_KEY);
    const today = normalizeDateString(getFormattedDate());
    return !!savedResults && normalizeDateString(savedDate) === today;
  };

  const checkBlitzCompleted = () => {
    if (typeof window === 'undefined') return false;
    const savedResults = localStorage.getItem(BLITZ_GAME_RESULTS_KEY);
    const savedDate = localStorage.getItem(BLITZ_GAME_DATE_KEY);
    const today = normalizeDateString(getFormattedDate());
    return !!savedResults && normalizeDateString(savedDate) === today;
  };

  const getModeStorage = (mode) => {
    const isBlitz = mode === 'blitz';
    const isPractice = mode === 'practice';
    return {
      storageKey: isBlitz ? BLITZ_STORAGE_KEY : (isPractice ? PRACTICE_STORAGE_KEY : STORAGE_KEY),
      dateKey: isBlitz ? BLITZ_GAME_DATE_KEY : (isPractice ? PRACTICE_GAME_DATE_KEY : GAME_DATE_KEY),
      resultsKey: isBlitz ? BLITZ_GAME_RESULTS_KEY : (isPractice ? PRACTICE_GAME_RESULTS_KEY : GAME_RESULTS_KEY),
      puzzleIdKey: isBlitz ? BLITZ_PUZZLE_ID_KEY : (isPractice ? PRACTICE_PUZZLE_ID_KEY : null),
      startTimeKey: isBlitz ? BLITZ_START_TIME_KEY : null
    };
  };

  const getModeEndpoints = (mode) => {
    const isBlitz = mode === 'blitz';
    const isPractice = mode === 'practice';
    return {
      puzzleEndpoint: isBlitz ? '/api/blitz-puzzle' : (isPractice ? '/api/practice-puzzle' : '/api/daily-puzzle'),
      leaderboardSubmit: isPractice ? null : (isBlitz ? '/api/blitz/leaderboard/submit' : '/api/leaderboard/submit'),
      leaderboardQuery: isPractice ? null : (isBlitz ? '/api/blitz/leaderboard' : '/api/leaderboard'),
      leaderboardTotal: isPractice ? null : (isBlitz ? '/api/blitz/leaderboard/total' : '/api/leaderboard/total'),
      wordBreakdownEndpoint: isPractice ? null : (isBlitz ? '/api/blitz/leaderboard/word-breakdown' : '/api/leaderboard/word-breakdown'),
      commentsSubmit: isPractice ? null : (isBlitz ? '/api/blitz/leaderboard/comments' : '/api/leaderboard/comments'),
      commentsQuery: isPractice ? null : (isBlitz ? '/api/blitz/leaderboard/comments' : '/api/leaderboard/comments')
    };
  };

  const resetCommentsState = () => {
    setComments([]);
    setHasRequestedComments(false);
    setCommentDraft('');
    setCommentError('');
    setCommentInfo('');
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
            resetCommentsState();
            
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
          resetCommentsState();
          
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
          setLeaderboardInfo(null);
          setWordBreakdown([]);
          setHasRequestedWordBreakdown(false);
          resetCommentsState();

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
          resetCommentsState();
          
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
      if (!(dailyCompleted || checkDailyCompleted())) {
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
          const today = normalizeDateString(getFormattedDate());
          const savedModeDate = normalizeDateString(localStorage.getItem(dateKey));
          const parsedModeDate = normalizeDateString(parsedState.date);
          const effectiveSavedDate = parsedModeDate || savedModeDate;

          if (effectiveSavedDate && effectiveSavedDate !== today) {
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
          setWordBreakdown([]);
          setHasRequestedWordBreakdown(false);
          resetCommentsState();

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

        const shouldRestoreFromSavedResults = !forceNewPuzzle && checkBlitzCompleted() && !!savedResults;
        let parsedSavedResults = null;
        if (shouldRestoreFromSavedResults) {
          try {
            parsedSavedResults = JSON.parse(savedResults);
          } catch (parseError) {
            console.error('Error parsing saved blitz results:', parseError);
          }
        }
        const canRestoreCompleted = shouldRestoreFromSavedResults && !!parsedSavedResults;

        const blitzPuzzle = await fetchPuzzle('blitz');
        if (blitzPuzzle) {
          setLetters(blitzPuzzle.letters);
          setBonusTilePositions(blitzPuzzle.bonusTilePositions);
          setDisplayDate(blitzPuzzle.displayDate);
          setPlacedTiles({});
          setUsedTileIds([]);
          setIsGameFinished(canRestoreCompleted);
          setGameResults(canRestoreCompleted ? parsedSavedResults : null);
          setLeaderboardInfo(null);
          setWordBreakdown([]);
          setHasRequestedWordBreakdown(false);
          resetCommentsState();
          setPuzzleId(blitzPuzzle.puzzleId || null);
          setBlitzTimeLeft(canRestoreCompleted ? 0 : BLITZ_DURATION_SECONDS);
          blitzAutoSubmitRef.current = canRestoreCompleted;
          setBlitzCompleted(canRestoreCompleted);

          const newGameState = {
            letters: blitzPuzzle.letters,
            placedTiles: {},
            usedTileIds: [],
            isGameFinished: canRestoreCompleted,
            date: blitzPuzzle.date,
            bonusTilePositions: blitzPuzzle.bonusTilePositions,
            displayDate: blitzPuzzle.displayDate,
            puzzleId: blitzPuzzle.puzzleId || null
          };

          localStorage.setItem(storageKey, JSON.stringify(newGameState));
          localStorage.setItem(dateKey, blitzPuzzle.date);
          if (puzzleIdKey && blitzPuzzle.puzzleId) {
            localStorage.setItem(puzzleIdKey, blitzPuzzle.puzzleId);
          }

          if (startTimeKey && !canRestoreCompleted) {
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

  const loadPracticeGameState = async ({ forceNewPuzzle = false, boardPayload = null } = {}) => {
    if (typeof window === 'undefined') return false;

    const { storageKey, dateKey, resultsKey, puzzleIdKey } = getModeStorage('practice');

    try {
      if (boardPayload) {
        clearPracticeShareImageCache();
        const importedState = {
          letters: boardPayload.letters,
          placedTiles: {},
          usedTileIds: [],
          isGameFinished: false,
          date: boardPayload.date || getFormattedDate(),
          bonusTilePositions: boardPayload.bonusTilePositions,
          displayDate: boardPayload.displayDate || 'Practice Game',
          puzzleId: boardPayload.puzzleId || null
        };

        setLetters(importedState.letters);
        setPlacedTiles({});
        setUsedTileIds([]);
        setBonusTilePositions(importedState.bonusTilePositions);
        setDisplayDate(importedState.displayDate);
        setPuzzleId(importedState.puzzleId);
        setIsGameFinished(false);
        setGameResults(null);
        setLeaderboardInfo(null);
        setWordBreakdown([]);
        setHasRequestedWordBreakdown(false);
        resetCommentsState();
        setValidationError('');
        setInvalidPlacement(false);
        localStorage.removeItem(resultsKey);
        localStorage.setItem(storageKey, JSON.stringify(importedState));
        localStorage.setItem(dateKey, importedState.date);
        if (puzzleIdKey && importedState.puzzleId) {
          localStorage.setItem(puzzleIdKey, importedState.puzzleId);
        }
        setIsLoading(false);
        return true;
      }

      const savedState = localStorage.getItem(storageKey);
      const savedResults = localStorage.getItem(resultsKey);
      const savedPuzzleId = puzzleIdKey ? localStorage.getItem(puzzleIdKey) : null;
      const shouldUseSaved = !forceNewPuzzle && !!savedState;

      if (shouldUseSaved) {
        const parsedState = JSON.parse(savedState);
        setLetters(parsedState.letters || []);
        setPlacedTiles(parsedState.placedTiles || {});
        setUsedTileIds(parsedState.usedTileIds || []);
        setBonusTilePositions(parsedState.bonusTilePositions || {});
        setDisplayDate(parsedState.displayDate || 'Practice Game');
        setPuzzleId(parsedState.puzzleId || savedPuzzleId || null);
        setIsGameFinished(parsedState.isGameFinished === true);
        setGameResults(savedResults ? JSON.parse(savedResults) : null);
        setLeaderboardInfo(null);
        setWordBreakdown([]);
        setHasRequestedWordBreakdown(false);
        resetCommentsState();
        setValidationError('');
        setInvalidPlacement(false);
        setIsLoading(false);
        return true;
      }

      const practicePuzzle = await fetchPuzzle('practice');
      if (!practicePuzzle) return false;
      clearPracticeShareImageCache();

      const nextDate = normalizeDateString(practicePuzzle.date || getFormattedDate());
      const nextState = {
        letters: practicePuzzle.letters || [],
        placedTiles: {},
        usedTileIds: [],
        isGameFinished: false,
        date: nextDate,
        bonusTilePositions: practicePuzzle.bonusTilePositions || {},
        displayDate: 'Practice Game',
        puzzleId: practicePuzzle.puzzleId || null
      };

      setLetters(nextState.letters);
      setPlacedTiles({});
      setUsedTileIds([]);
      setBonusTilePositions(nextState.bonusTilePositions);
      setDisplayDate(nextState.displayDate);
      setPuzzleId(nextState.puzzleId);
      setIsGameFinished(false);
      setGameResults(null);
      setLeaderboardInfo(null);
      setWordBreakdown([]);
      setHasRequestedWordBreakdown(false);
      resetCommentsState();
      setValidationError('');
      setInvalidPlacement(false);
      localStorage.setItem(storageKey, JSON.stringify(nextState));
      localStorage.setItem(dateKey, nextDate);
      localStorage.removeItem(resultsKey);
      if (puzzleIdKey && nextState.puzzleId) {
        localStorage.setItem(puzzleIdKey, nextState.puzzleId);
      }
      return true;
    } catch (error) {
      console.error("Error loading practice game state:", error);
      setIsLoading(false);
      return false;
    }
  };

  const loadGameState = async (mode, options = {}) => {
    if (mode === 'blitz') {
      return loadBlitzGameState(options);
    }
    if (mode === 'practice') {
      return loadPracticeGameState(options);
    }
    return loadDailyGameState();
  };

  // Reset the game state
  const resetGame = async () => {
    if (isBlitzMode) {
      await loadBlitzGameState({ forceNewPuzzle: !checkBlitzCompleted() });
      return;
    }
    if (isPracticeMode) {
      await loadPracticeGameState({ forceNewPuzzle: true });
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
      resetCommentsState();
      
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
      if (mode === 'daily' || mode === 'blitz') {
        localStorage.setItem(LEADERBOARD_MODE_KEY, mode);
      }
      setPracticeQueryParams({ enabled: mode === 'practice' });
    }
    if (mode === 'blitz' && !(dailyCompleted || checkDailyCompleted())) {
      setValidationError('Finish the daily puzzle to unlock Blitz Mode.');
      return;
    }
    isModeSwitchingRef.current = true;
    setIsLoading(true);
    try {
      setGameMode(mode);
      setLeaderboardInfo(null);
      setWordBreakdown([]);
      setHasRequestedWordBreakdown(false);
      resetCommentsState();
      setValidationError('');
      setInvalidPlacement(false);
      setPracticeBoardShareMessage('');
      await loadGameState(mode, { forceNewPuzzle });
    } finally {
      isModeSwitchingRef.current = false;
    }
  };

  const openBlitzFromDaily = async () => {
    const shouldReviewBlitz = blitzCompleted || checkBlitzCompleted();
    await switchGameMode('blitz', { forceNewPuzzle: !shouldReviewBlitz });
  };

  const forceDailyMode = async () => {
    await switchGameMode('daily');
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
        const completionDaily = checkDailyCompleted();
        const completionBlitz = checkBlitzCompleted();
        setDailyCompleted(completionDaily);
        setBlitzCompleted(completionBlitz);

        const params = new URLSearchParams(window.location.search);
        const sharedBoardEncoded = params.get(PRACTICE_BOARD_QUERY_KEY);
        const practiceModeParam = params.get(PRACTICE_MODE_QUERY_KEY);
        if (sharedBoardEncoded) {
          try {
            const decodedPayload = decodeBoardPayload(sharedBoardEncoded);
            const normalizedPayload = normalizePracticeBoardPayload(decodedPayload);
            if (normalizedPayload) {
              setGameMode('practice');
              const loadedSharedBoard = await loadPracticeGameState({ boardPayload: normalizedPayload });
              if (loadedSharedBoard) {
                setPracticeQueryParams({ enabled: true });
                return;
              }
            }
          } catch (error) {
            console.error('Failed to parse shared practice board data:', error);
          }
        }

        if (practiceModeParam === PRACTICE_MODE_QUERY_VALUE) {
          setGameMode('practice');
          const hasLoadedPracticeState = await loadPracticeGameState();
          if (hasLoadedPracticeState) {
            setPracticeQueryParams({ enabled: true });
            return;
          }
        }

        setPracticeQueryParams({ enabled: false });
        setGameMode('daily');
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
    if (isLoading || isModeSwitchingRef.current) return;
    if (letters.length > 0) {
      saveGameState();
    }
  }, [letters, placedTiles, usedTileIds, isGameFinished, gameResults, bonusTilePositions, displayDate, puzzleId, isLoading]);
  
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
    setPlayerNickname(getStoredNickname());
  }, []);

  useEffect(() => {
    const syncNicknameFromStorage = () => {
      setPlayerNickname(getStoredNickname());
    };

    syncNicknameFromStorage();
    window.addEventListener('scraple:nickname-updated', syncNicknameFromStorage);
    window.addEventListener('storage', syncNicknameFromStorage);
    return () => {
      window.removeEventListener('scraple:nickname-updated', syncNicknameFromStorage);
      window.removeEventListener('storage', syncNicknameFromStorage);
    };
  }, []);
  
  // Submit score to leaderboard
  const submitScoreToLeaderboard = async (results, mode = gameMode, streakCount = null) => {
    if (!playerId || !results) return null;
    if (mode === 'practice') return null;
    
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
          playerId,
          streak: streakCount
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

  const fetchWordBreakdown = async (
    mode = gameMode,
    { finished = isGameFinished, results = gameResults } = {}
  ) => {
    if (mode === 'practice') {
      if (!finished || !results) return;
      setIsFetchingWordBreakdown(true);
      setHasRequestedWordBreakdown(true);
      try {
        const response = await fetch('/api/practice-word-breakdown', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            words: Array.isArray(results?.words) ? results.words : [],
            bonusTilePositions: bonusTilePositions || {}
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch practice word breakdown: ${response.status}`);
        }

        const data = await response.json();
        setWordBreakdown(Array.isArray(data.words) ? data.words : []);
      } catch (error) {
        console.error('Error fetching practice word breakdown:', error);
        setWordBreakdown([]);
      } finally {
        setIsFetchingWordBreakdown(false);
      }
      return;
    }
    if (!playerId || !finished || !results) return;

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

  const parseCommentIdentity = (usernameValue) => {
    const username = String(usernameValue || '').trim();
    if (!username) {
      return { nickname: '', hash: '000000' };
    }

    const splitAt = username.lastIndexOf('#');
    if (splitAt > 0) {
      const nickname = username.slice(0, splitAt).trim();
      const hash = username.slice(splitAt + 1).trim().toUpperCase();
      return { nickname, hash: hash || '000000' };
    }

    return {
      nickname: '',
      hash: username.toUpperCase() || '000000'
    };
  };

  const parseComments = (rawComments) => {
    if (!Array.isArray(rawComments)) return [];

    return rawComments
      .map((rawComment) => {
        if (typeof rawComment !== 'string') return null;
        try {
          const parsed = JSON.parse(rawComment);
          const parsedIdentity = parseCommentIdentity(parsed?.username);
          const commentText = String(parsed?.comment || '').trim();
          if (!commentText) return null;

          return {
            username: String(parsed?.username || '').trim(),
            comment: commentText,
            timestamp: String(parsed?.timestamp || ''),
            nickname: parsedIdentity.nickname,
            hash: parsedIdentity.hash
          };
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
  };

  const fetchComments = async (
    mode = gameMode,
    { finished = isGameFinished, results = gameResults } = {}
  ) => {
    if (mode === 'practice') {
      setComments([]);
      setHasRequestedComments(true);
      return;
    }
    if (!playerId || !finished || !results) return;

    setIsFetchingComments(true);
    setHasRequestedComments(true);
    setCommentError('');
    setCommentInfo('');

    try {
      const { commentsQuery } = getModeEndpoints(mode);
      const params = new URLSearchParams({ playerId });
      const response = await fetch(`${commentsQuery}?${params.toString()}`);

      if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
          setComments([]);
          return;
        }
        throw new Error(`Failed to fetch comments: ${response.status}`);
      }

      const data = await response.json();
      setComments(parseComments(data.comments));
    } catch (error) {
      console.error('Error fetching comments:', error);
      setComments([]);
      setCommentError('Failed to load comments.');
    } finally {
      setIsFetchingComments(false);
    }
  };

  const fetchBotGamePreview = async () => {
    if (typeof window === 'undefined') return;
    if (isBlitzMode || isPracticeMode) return;
    const puzzleDate = normalizeDateString(localStorage.getItem(GAME_DATE_KEY) || getFormattedDate());
    if (!puzzleDate) {
      setBotGamePreview(null);
      return;
    }

    try {
      const response = await fetch(`/api/bot-daily?date=${encodeURIComponent(puzzleDate)}`);
      if (!response.ok) {
        if (response.status === 404) {
          setBotGamePreview(null);
          return;
        }
        throw new Error(`Failed to fetch bot game preview: ${response.status}`);
      }
      const data = await response.json();
      setBotGamePreview(data);
    } catch (error) {
      console.error('Error fetching bot game preview:', error);
      setBotGamePreview(null);
    }
  };

  const submitComment = async () => {
    if (isPracticeMode) return;
    if (!playerId || !isGameFinished || !gameResults) return;
    if (isSubmittingComment) return;

    const trimmed = commentDraft.trim();
    if (!trimmed) {
      setCommentError('Enter a comment first.');
      return;
    }
    if (trimmed.length > COMMENT_MAX_LENGTH) {
      setCommentError(`Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`);
      return;
    }

    setIsSubmittingComment(true);
    setCommentError('');
    setCommentInfo('');

    try {
      const { commentsSubmit } = getModeEndpoints(gameMode);
      const { dateKey } = getModeStorage(gameMode);
      const currentDate = localStorage.getItem(dateKey) || getFormattedDate();
      const commentGameState = {
        placedTiles,
        bonusTilePositions,
        date: currentDate,
        puzzleId: gameMode === 'blitz' ? puzzleId : undefined
      };
      const response = await fetch(commentsSubmit, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          playerId,
          comment: trimmed,
          gameState: commentGameState
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          setCommentInfo('You already left a comment for this puzzle today.');
          setCommentDraft('');
          await fetchComments(gameMode);
          return;
        }
        setCommentError(data?.error || 'Failed to submit comment.');
        return;
      }

      setCommentDraft('');
      setCommentInfo('Comment posted.');
      await fetchComments(gameMode);
    } catch (error) {
      console.error('Error submitting comment:', error);
      setCommentError('Failed to submit comment.');
    } finally {
      setIsSubmittingComment(false);
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
      
      const { storageKey, dateKey, resultsKey, puzzleIdKey } = getModeStorage(gameMode);
      // Get the current date from localStorage to ensure consistency
      const currentDate = localStorage.getItem(dateKey) || getFormattedDate();
      recordCompletedGameStats({
        date: currentDate,
        mode: gameMode,
        score: results.totalScore,
        puzzleId: gameMode === 'blitz' ? puzzleId : null,
        displayDate,
        placedTiles,
        bonusTilePositions
      });
      const streakCount = isPracticeMode
        ? null
        : updateStreakOnPuzzleComplete({
            mode: gameMode,
            puzzleDate: currentDate
          });
      if (!isPracticeMode) {
        window.dispatchEvent(new CustomEvent('scraple:streak-updated'));
      }

      // Submit score to leaderboard
      const submitResult = await submitScoreToLeaderboard(results, gameMode, streakCount);
      await fetchWordBreakdown(gameMode, { finished: true, results });
      await fetchComments(gameMode, { finished: true, results });
      if (typeof window !== 'undefined' && !isPracticeMode) {
        localStorage.setItem(LEADERBOARD_MODE_KEY, gameMode);
      }
      if (gameMode === 'daily') {
        setDailyCompleted(true);
      } else if (gameMode === 'blitz') {
        setBlitzCompleted(true);
      }

      const resultsForStorage = submitResult && typeof submitResult.percentile === 'number'
        ? { ...results, percentile: submitResult.percentile }
        : results;
      
      // Force an immediate save of the game state with the updated isGameFinished flag
      const gameState = {
        letters,
        placedTiles,
        usedTileIds,
        isGameFinished: true, // Explicitly set to true
        date: currentDate, // Use the date from localStorage
        bonusTilePositions,
        displayDate,
        puzzleId: (isBlitzMode || isPracticeMode) ? puzzleId : undefined
      };
      
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(gameState));
        localStorage.setItem(dateKey, currentDate);
        localStorage.setItem(resultsKey, JSON.stringify(resultsForStorage));
        if (puzzleIdKey && puzzleId) {
          localStorage.setItem(puzzleIdKey, puzzleId);
        }
      }

      if (!getStoredNickname() && !hasDismissedNicknamePrompt()) {
        setShowNicknamePrompt(true);
      }
    } catch (error) {
      console.error("Error calculating game results:", error);
      alert("There was an error calculating your score. Please try again.");
    } finally {
      setIsCalculating(false);
    }
  };

  useEffect(() => {
    finalizeGameRef.current = finalizeGame;
  }, [finalizeGame]);

  const handleConfirm = async () => {
    await finalizeGame();
  };

  // Handle sharing game results
  const handleShare = () => {
    if (!gameResults) return;
    if (typeof window !== 'undefined') {
      localStorage.setItem(SHARE_MODE_KEY, isPracticeMode ? 'practice' : (isBlitzMode ? 'blitz' : 'daily'));
    }
    setActivePopup('share');
  };

  const startNewPracticeGame = async () => {
    clearPracticeShareImageCache();
    await switchGameMode('practice', { forceNewPuzzle: true });
  };

  const handleSharePracticeBoard = async () => {
    if (typeof window === 'undefined' || !isPracticeMode) return;
    try {
      const payload = {
        letters,
        bonusTilePositions,
        puzzleId: puzzleId || null
      };
      const encoded = encodeBoardPayload(payload);
      const shareUrl = `https://scraple.io?${PRACTICE_MODE_QUERY_KEY}=${PRACTICE_MODE_QUERY_VALUE}&${PRACTICE_BOARD_QUERY_KEY}=${encodeURIComponent(encoded)}`;
      await navigator.clipboard.writeText(shareUrl);
      setPracticeBoardShareMessage('Practice board link copied.');
    } catch (error) {
      console.error('Failed to copy practice board link:', error);
      setPracticeBoardShareMessage('Unable to copy board link.');
    }

    setTimeout(() => {
      setPracticeBoardShareMessage('');
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
    
    if (!(dailyCompleted || checkDailyCompleted())) {
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
        if (finalizeGameRef.current) {
          finalizeGameRef.current({ skipValidation: true });
        }
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
  }, [isBlitzMode, isGameFinished, gameMode, dailyCompleted]);
  
  // Add a new useEffect to fetch leaderboard info when the game is loaded as finished
  useEffect(() => {
    const fetchLeaderboardInfo = async () => {
      // Only fetch if the game is finished, we have results, and we have a playerId
      if (gameMode === 'practice') return;
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
    if (gameMode === 'practice') return;
    if (!isGameFinished || !gameResults || !playerId) return;
    if (isFetchingWordBreakdown) return;
    if (hasRequestedWordBreakdown || wordBreakdown.length > 0) return;
    fetchWordBreakdown(gameMode);
  }, [isGameFinished, gameResults, playerId, gameMode, puzzleId, wordBreakdown.length, isFetchingWordBreakdown, hasRequestedWordBreakdown]);

  useEffect(() => {
    if (gameMode === 'practice') return;
    if (!isGameFinished || !gameResults || !playerId) return;
    if (isFetchingComments) return;
    if (hasRequestedComments || comments.length > 0) return;
    fetchComments(gameMode);
  }, [isGameFinished, gameResults, playerId, gameMode, comments.length, isFetchingComments, hasRequestedComments]);

  useEffect(() => {
    if (!isGameFinished || !gameResults || isBlitzMode || isPracticeMode) {
      setBotGamePreview(null);
      return;
    }
    fetchBotGamePreview();
  }, [isGameFinished, gameResults, isBlitzMode, isPracticeMode]);
  
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
        puzzleId: (isBlitzMode || isPracticeMode) ? puzzleId : undefined
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
    usedBonusTypes: getUsedBonusTypesForWord(wordResult.positions || [], bonusTilePositions || {}),
    bonusPraise: getBonusPraiseForWord(wordResult.score, getUsedBonusTypesForWord(wordResult.positions || [], bonusTilePositions || {}), wordResult.valid),
    isHighScoringSpecial: wordResult.valid && wordResult.score > 50,
    isUniqueTodaySpecial: false,
    isSpecial: wordResult.valid && wordResult.score > 50
  }));
  const displayedWordBreakdown = wordBreakdown.length > 0 ? wordBreakdown : fallbackWordBreakdown;
  const hasSubmittedWords = Array.isArray(gameResults?.words) && gameResults.words.length > 0;
  const botScore = typeof botGamePreview?.score === 'number' ? botGamePreview.score : null;
  const playerScore = typeof gameResults?.totalScore === 'number' ? gameResults.totalScore : null;
  const hasBotScoreComparison = botScore !== null && playerScore !== null;
  const didBeatBot = hasBotScoreComparison && playerScore > botScore;
  const tiedBot = hasBotScoreComparison && playerScore === botScore;
  const lostToBot = hasBotScoreComparison && playerScore < botScore;
  const headerDisplayDate = isPracticeMode ? getDisplayDate() : displayDate;
  const currentPlayerHash = playerId ? getPlayerHash(playerId) : null;
  const hasPlayerComment = currentPlayerHash
    ? comments.some((entry) => entry.hash === currentPlayerHash)
    : false;
  const commentProgressPercent = Math.min(100, Math.max(0, (commentDraft.length / COMMENT_MAX_LENGTH) * 100));
  
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
            message={isBlitzMode
              ? "Submit your Blitz board now?"
              : (isPracticeMode ? "Submit your Practice board now?" : "Are you sure you're done? You get one submission per day!")} 
            confirm={handleConfirm} 
            cancel={() => setShowFinishPopup(false)} />
        )
      }
      {showNicknamePrompt && (
        <NicknamePrompt
          playerId={playerId}
          onDismiss={() => setShowNicknamePrompt(false)}
          onSaved={(savedNickname) => {
            setStoredNickname(savedNickname);
            setPlayerNickname(savedNickname);
            setShowNicknamePrompt(false);
          }}
        />
      )}
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
              <p>{headerDisplayDate}</p>
              {isBlitzMode && (
                <span className={styles.modeBadge}>Blitz Mode</span>
              )}
              {isPracticeMode && (
                <span className={styles.modeBadge}>Practice Mode</span>
              )}
            </div>

            <div className={styles.gameHeaderButtons}>
              <div className={styles.desktopHeaderActions}>
                {(isBlitzMode || isPracticeMode) ? (
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
                      onClick={openBlitzFromDaily}
                      title={blitzCompleted ? "Review Blitz Mode" : "Play Blitz Mode"}
                    >
                      <IoMdFlash />
                    </button>
                  )
                )}
                <button 
                  className={styles.gameHeaderButton}
                  onClick={() => {
                    localStorage.setItem(LEADERBOARD_MODE_KEY, gameMode === 'blitz' ? 'blitz' : 'daily');
                    setActivePopup("leaderboard");
                  }}
                  data-umami-event="View leaderboard"
                >
                  <IoMdTrophy />
                </button>
                <button
                  className={styles.gameHeaderButton}
                  onClick={() => setActivePopup("profile")}
                  title={playerNickname ? `Nickname: ${playerNickname}` : 'Set nickname'}
                  data-umami-event="Open profile popup"
                >
                  <IoMdPerson />
                </button>
                <button
                  className={styles.gameHeaderButton}
                  onClick={() => switchGameMode('practice')}
                  title="Practice Mode"
                  data-umami-event="Open practice mode"
                >
                  <IoMdShuffle />
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
              <button 
                className={styles.mobileLeaderboardButton}
                onClick={() => {
                  localStorage.setItem(LEADERBOARD_MODE_KEY, gameMode === 'blitz' ? 'blitz' : 'daily');
                  setActivePopup("leaderboard");
                }}
                data-umami-event="View leaderboard"
              >
                <IoMdTrophy />
              </button>
              <button
                className={styles.mobileMenuButton}
                onClick={() => setIsMobileSidebarOpen((prev) => !prev)}
                aria-label={isMobileSidebarOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={isMobileSidebarOpen}
                aria-controls="mobile-sidebar"
              >
                {isMobileSidebarOpen ? <IoMdClose /> : <IoMdMenu />}
              </button>
            </div>
          </div>

          <div
            className={`${styles.mobileSidebarBackdrop} ${isMobileSidebarOpen ? styles.mobileSidebarBackdropOpen : ''}`}
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <aside
            id="mobile-sidebar"
            className={`${styles.mobileSidebar} ${isMobileSidebarOpen ? styles.mobileSidebarOpen : ''}`}
            aria-hidden={!isMobileSidebarOpen}
          >
            <div className={styles.mobileSidebarItems}>
              {(isBlitzMode || isPracticeMode) ? (
                <button
                  className={styles.mobileSidebarItem}
                  onClick={() => {
                    switchGameMode('daily');
                    setIsMobileSidebarOpen(false);
                  }}
                >
                  <IoMdCalendar />
                  <span>Daily Mode</span>
                </button>
              ) : (
                <button
                  className={styles.mobileSidebarItem}
                  onClick={() => {
                    if (dailyCompleted) {
                      openBlitzFromDaily();
                      setIsMobileSidebarOpen(false);
                    }
                  }}
                  disabled={!dailyCompleted}
                  title={dailyCompleted ? (blitzCompleted ? "Review Blitz Mode" : "Play Blitz Mode") : 'Finish Daily Mode to unlock Blitz'}
                >
                  <IoMdFlash />
                  <span>{dailyCompleted ? (blitzCompleted ? 'Review Blitz Mode' : 'Play Blitz Mode') : 'Blitz Locked'}</span>
                </button>
              )}

              <button
                className={styles.mobileSidebarItem}
                onClick={() => {
                  switchGameMode('practice');
                  setIsMobileSidebarOpen(false);
                }}
              >
                <IoMdShuffle />
                <span>Practice Mode</span>
              </button>

              <button
                className={styles.mobileSidebarItem}
                onClick={() => {
                  setActivePopup("profile");
                  setIsMobileSidebarOpen(false);
                }}
                data-umami-event="Open profile popup"
              >
                <IoMdPerson />
                <span>Profile</span>
              </button>

              <button
                className={styles.mobileSidebarItem}
                onClick={() => {
                  setActivePopup("help");
                  setIsMobileSidebarOpen(false);
                }}
              >
                <IoMdHelpCircleOutline />
                <span>Help</span>
              </button>

              <button
                className={styles.mobileSidebarItem}
                onClick={() => {
                  setActivePopup("info");
                  setIsMobileSidebarOpen(false);
                }}
              >
                <IoMdInformationCircleOutline />
                <span>Info</span>
              </button>
            </div>

            <div className={styles.mobileSidebarFooter}>
              <div className={styles.mobileThemeLabel}>Theme</div>
              <ThemeToggle variant="slider" />
            </div>
          </aside>

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
            {practiceBoardShareMessage && !isGameFinished && (
              <div className={styles.calculatingMessage}>
                {practiceBoardShareMessage}
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
              {isPracticeMode && !isGameFinished && (
                <div
                  onClick={handleSharePracticeBoard}
                  className={styles.shareBoardButton}
                >
                  <IoShareSocialOutline />
                  <div className={styles.buttonLabel}>
                    Share
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {isGameFinished && !isCalculating && (
            <div className={styles.gameFinishedMessage}>
              {isBlitzMode
                ? "Blitz complete! Nice run."
                : (isPracticeMode ? "Practice game complete! Keep training." : "Game completed! Come back tomorrow for a new challenge.")}
            </div>
          )}

          {isGameFinished && !isCalculating && !isBlitzMode && !isPracticeMode && (
            <div className={styles.blitzPrompt}>
              <div className={styles.blitzPromptText}>
                Want to try Blitz Mode? You have 60 seconds to get a highscore!
              </div>
              <button
                className={styles.blitzButton}
                onClick={openBlitzFromDaily}
              >
                {blitzCompleted ? 'Review Game' : 'Play Blitz Mode'}
              </button>
            </div>
          )}

          {isGameFinished && !isCalculating && isPracticeMode && (
            <div className={styles.blitzPrompt}>
              <div className={styles.blitzPromptText}>
                Want another practice board?
              </div>
              <button
                className={styles.blitzButton}
                onClick={startNewPracticeGame}
              >
                Start New Practice Game
              </button>
            </div>
          )}

          {isGameFinished && !isCalculating && isBlitzMode && (
            <div className={styles.blitzPrompt}>
              <div className={styles.blitzPromptText}>
                See my daily puzzle
              </div>
              <button
                className={styles.blitzButton}
                onClick={() => switchGameMode('daily')}
              >
                Back to Game
              </button>
            </div>
          )}

          {/* Game Results Section */}
          {isGameFinished && gameResults && (
            <div className={styles.resultsContainer}>
              <h2 className={styles.resultsTitle}>
                {isBlitzMode ? 'Blitz Results' : (isPracticeMode ? 'Practice Results' : 'Game Results')}
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
              {!isPracticeMode && leaderboardInfo && (
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
                    data-umami-event="View leaderboard"
                  >
                    <IoMdTrophy /> View Full Leaderboard
                  </button>
                </div>
              )}
              
              <div className={styles.shareContainer}>
                <div className={styles.shareButtonsRow}>
                  <button 
                    className={styles.shareButton}
                    onClick={handleShare}
                    data-umami-event="Open share board image popup"
                  >
                    <IoShareSocialOutline /> 
                    Share my board
                    {showShareNewBadge && <span className={styles.newBadge}>NEW!</span>}
                  </button>
                  {isPracticeMode && (
                    <button
                      className={`${styles.shareButton} ${styles.practiceShareButton}`}
                      onClick={handleSharePracticeBoard}
                      data-umami-event="Copy practice board link"
                    >
                      <IoShareSocialOutline />
                      Share practice board link
                    </button>
                  )}
                </div>
                {practiceBoardShareMessage && <div className={styles.shareMessage}>{practiceBoardShareMessage}</div>}
              </div>

              {!isBlitzMode && !isPracticeMode && (
                <div className={`${styles.botGameContainer} ${didBeatBot ? styles.botGameContainerWin : ''}`}>
                  <div className={styles.botGameText}>
                    <Image
                      src="/images/robot.png"
                      alt="ScrapleBot"
                      width={18}
                      height={18}
                      className={styles.botGameIcon}
                    />
                    {lostToBot && `See how the ScrapleBot earned ${botScore} points`}
                    {tiedBot && 'You tied with the ScrapleBot! See how it played.'}
                    {didBeatBot && `🎉 You beat the ScrapleBot! It only earned ${botScore} points. View its game ✨`}
                    {!hasBotScoreComparison && 'ScrapleBot is still solving. Check how it played soon.'}
                  </div>
                  <button
                    className={styles.botGameButton}
                    onClick={() => setActivePopup('botGame')}
                    data-umami-event="Open bot game popup"
                  >
                    Show Bot Game
                  </button>
                </div>
              )}
              
              <div className={styles.wordsContainer}>
                <h3>Word Breakdown</h3>
                {!isPracticeMode && isFetchingWordBreakdown && (
                  <div className={styles.wordsLoading}>Loading definitions and usage stats...</div>
                )}
                {!isFetchingWordBreakdown && !hasSubmittedWords && (
                  <div className={styles.wordsLoading}>You did not create any words.</div>
                )}
                {!isPracticeMode && !isFetchingWordBreakdown && hasSubmittedWords && wordBreakdown.length === 0 && (
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
                      {!isPracticeMode && (
                        <div className={styles.breakdownMeta}>
                          {wordResult.playedByOthersCount === null
                            ? 'Usage stats loading...'
                            : `${wordResult.playedByOthersCount} other player${wordResult.playedByOthersCount === 1 ? '' : 's'} used this word today`}
                        </div>
                      )}
                      {!isPracticeMode && (
                        <div className={styles.breakdownMetaSecondary}>
                          {typeof wordResult.averageScoreAmongPlayers === 'number'
                            ? `Average score of players who used this word: ${wordResult.averageScoreAmongPlayers.toFixed(2)}`
                            : 'Average score of players who used this word: loading...'}
                        </div>
                      )}
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

              {!isPracticeMode && (
              <div className={styles.commentsContainer}>
                <h3>Leave a comment</h3>
                <textarea
                  className={styles.commentTextarea}
                  value={commentDraft}
                  onChange={(event) => {
                    const nextValue = event.target.value.slice(0, COMMENT_MAX_LENGTH);
                    setCommentDraft(nextValue);
                    if (commentError) {
                      setCommentError('');
                    }
                    if (commentInfo) {
                      setCommentInfo('');
                    }
                  }}
                  placeholder="Share your thoughts on today's puzzle..."
                  maxLength={COMMENT_MAX_LENGTH}
                  disabled={isSubmittingComment || hasPlayerComment}
                />
                <div className={styles.commentFooter}>
                  <div className={styles.commentCounter}>
                    <span
                      className={styles.commentCounterProgress}
                      style={{
                        background: `conic-gradient(#4b79ff ${commentProgressPercent}%, rgba(75, 121, 255, 0.2) ${commentProgressPercent}% 100%)`
                      }}
                    ></span>
                    {commentDraft.length}/{COMMENT_MAX_LENGTH}
                  </div>
                  <button
                    className={styles.commentSubmitButton}
                    onClick={submitComment}
                    disabled={isSubmittingComment || hasPlayerComment || commentDraft.trim().length === 0}
                  >
                    {isSubmittingComment ? 'Posting...' : 'Post comment'}
                  </button>
                </div>
                {commentError && <div className={styles.commentError}>{commentError}</div>}
                {commentInfo && <div className={styles.commentInfo}>{commentInfo}</div>}
                {hasPlayerComment && (
                  <div className={styles.commentInfoRight}>You already left a comment for this puzzle today.</div>
                )}

                <h4 className={styles.commentsListTitle}>Comments</h4>
                {isFetchingComments && (
                  <div className={styles.commentsLoading}>Loading comments...</div>
                )}
                {!isFetchingComments && comments.length === 0 && (
                  <div className={styles.commentsLoading}>No comments yet.</div>
                )}
                <ul className={styles.commentsList}>
                  {comments.map((entry, index) => (
                    <li key={`${entry.username}-${entry.timestamp}-${index}`} className={styles.commentItem}>
                      <div className={styles.commentIdentity}>
                        {entry.nickname ? (
                          <>
                            <span
                              className={styles.commentNicknameBadge}
                              style={getNicknameBadgeStyle(entry.hash)}
                            >
                              {entry.nickname}
                            </span>
                            <span className={styles.commentHashTag}>#{entry.hash}</span>
                          </>
                        ) : (
                          <span className={styles.commentHashTag}>#{entry.hash}</span>
                        )}
                      </div>
                      <div className={styles.commentText}>{entry.comment}</div>
                    </li>
                  ))}
                </ul>
              </div>
              )}
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
            {isPracticeMode && !isGameFinished && (
              <div
                onClick={handleSharePracticeBoard}
                className={styles.shareBoardButton}
              >
                <IoShareSocialOutline />
                <div className={styles.buttonLabel}>
                  Share
                </div>
              </div>
            )}
          </div>
          
          {/* Reset all data button has been moved to the info popup */}
        </div>
      </div>
    </DndContext>
  );
}
