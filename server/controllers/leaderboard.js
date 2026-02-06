const fs = require('fs');
const path = require('path');
const { getEasternDateString, getEasternDisplayDate, getOrCreateDailyPuzzle } = require('../lib/dailyPuzzle');

// Redis key for storing the daily leaderboard
const REDIS_KEY_PREFIX = 'scraple:leaderboard:';
const DAILY_PUZZLE_PREFIX = 'scraple:daily:';
const BLITZ_LEADERBOARD_PREFIX = 'scraple:blitz:leaderboard:';
const BLITZ_DAILY_PREFIX = 'scraple:blitz:daily:';
const WORD_AVG_SCORE_SUFFIX = ':word-avg-score';
const WORD_AVG_PLAYERS_SUFFIX = ':word-avg-score:players';
const DICTIONARY_INFO_KEY = 'scraple:dictionary:info';
const DICTIONARY_VERSION_KEY = 'scraple:dictionary:version';
const DICTIONARY_VERSION = 'collins-2019-defs-v2';
const DICTIONARY_MIN_EXPECTED_SIZE = 200000;

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

const parseDictionaryLine = (line) => {
  if (!line || !line.trim()) return null;
  if (line.startsWith('Collins Scrabble Words')) return null;
  const parts = line.split('\t');
  if (parts.length < 2) return null;
  const word = parts[0].trim().toLowerCase();
  const definition = parts.slice(1).join('\t').trim();
  if (!word || !definition) return null;
  return { word, definition };
};

// Function to initialize dictionary in Redis if it doesn't exist or version changes
const initializeDictionary = async (redisClient) => {
  try {
    const existingVersion = await redisClient.get(DICTIONARY_VERSION_KEY);
    const infoSize = await redisClient.hLen(DICTIONARY_INFO_KEY);
    const hasInfo = infoSize > 0;
    if (
      existingVersion === DICTIONARY_VERSION &&
      hasInfo &&
      infoSize >= DICTIONARY_MIN_EXPECTED_SIZE
    ) {
      return;
    }

    await redisClient.del('scraple:dictionary', DICTIONARY_INFO_KEY, DICTIONARY_VERSION_KEY);

    // Read dictionary file with definitions
    const dictionaryPath = path.join(__dirname, '..', '..', 'Collins Scrabble Words (2019) with definitions.txt');
    const dictionaryContent = fs.readFileSync(dictionaryPath, 'utf8');
    const lines = dictionaryContent.split('\n');

    const infoEntries = [];

    for (const line of lines) {
      const parsed = parseDictionaryLine(line);
      if (!parsed) continue;
      infoEntries.push(parsed);
    }

    const chunkSize = 1000;
    for (let i = 0; i < infoEntries.length; i += chunkSize) {
      const infoChunk = infoEntries.slice(i, i + chunkSize);
      const infoPairs = [];
      for (const entry of infoChunk) {
        infoPairs.push(entry.word, entry.definition);
      }
      if (infoPairs.length > 0) {
        // Use HMSET for maximum Redis-version compatibility.
        await redisClient.sendCommand(['HMSET', DICTIONARY_INFO_KEY, ...infoPairs]);
      }
    }

    const finalSize = await redisClient.hLen(DICTIONARY_INFO_KEY);
    await redisClient.set(DICTIONARY_VERSION_KEY, DICTIONARY_VERSION);
    console.log(`Initialized dictionary with ${infoEntries.length} words and definitions (stored: ${finalSize})`);
  } catch (error) {
    console.error('Error initializing dictionary:', error);
    throw error;
  }
};

// Function to check if a word is valid using Redis
const isValidWord = async (redisClient, word) => {
  try {

    // Ensure dictionary is initialized
    await initializeDictionary(redisClient);
    
    // Check if word exists in Redis hash
    return await redisClient.hExists(DICTIONARY_INFO_KEY, word.toLowerCase());
  } catch (error) {
    console.error('Error checking word validity:', error);
    return false;
  }
};

// Function to get word definition/info from Redis
const getWordInfo = async (redisClient, word) => {
  try {
    await initializeDictionary(redisClient);
    return await redisClient.hGet(DICTIONARY_INFO_KEY, word.toLowerCase());
  } catch (error) {
    console.error('Error getting word info:', error);
    return null;
  }
};

// Function to calculate word score
const calculateWordScore = (word, bonusTiles, wordPositions) => {
  let wordScore = 0;
  let wordMultiplier = 1;
  
  // Calculate score for each letter, considering bonus tiles
  word.forEach((letter, index) => {
    const position = wordPositions[index];
    const letterScore = letterPoints[letter.letter];
    
    // Check if this position has a bonus
    if (bonusTiles.DOUBLE_LETTER && 
        bonusTiles.DOUBLE_LETTER[0] === position.row && 
        bonusTiles.DOUBLE_LETTER[1] === position.col) {
      wordScore += letterScore * 2;
    } else if (bonusTiles.TRIPLE_LETTER && 
               bonusTiles.TRIPLE_LETTER[0] === position.row && 
               bonusTiles.TRIPLE_LETTER[1] === position.col) {
      wordScore += letterScore * 3;
    } else {
      wordScore += letterScore;
    }
    
    // Check for word multipliers
    if (bonusTiles.DOUBLE_WORD && 
        bonusTiles.DOUBLE_WORD[0] === position.row && 
        bonusTiles.DOUBLE_WORD[1] === position.col) {
      wordMultiplier *= 2;
    } else if (bonusTiles.TRIPLE_WORD && 
               bonusTiles.TRIPLE_WORD[0] === position.row && 
               bonusTiles.TRIPLE_WORD[1] === position.col) {
      wordMultiplier *= 3;
    }
  });
  
  // Apply word multiplier
  return wordScore * wordMultiplier;
};

// Function to calculate total score
const calculateTotalScore = async (redisClient, placedTiles, bonusTilePositions) => {
  const boardSize = 5;
  const board = Array(boardSize).fill().map(() => Array(boardSize).fill(null));
  
  // Fill the board with placed tiles
  Object.entries(placedTiles).forEach(([position, letter]) => {
    const [row, col] = position.split('-').map(Number);
    board[row][col] = letter;
  });
  
  // Find all horizontal words
  const horizontalWords = [];
  const horizontalWordPositions = [];
  
  for (let row = 0; row < boardSize; row++) {
    let currentWord = [];
    let currentWordPositions = [];
    
    for (let col = 0; col < boardSize; col++) {
      if (board[row][col]) {
        currentWord.push(board[row][col]);
        currentWordPositions.push({ row, col });
      } else if (currentWord.length > 0) {
        if (currentWord.length > 1) {
          horizontalWords.push([...currentWord]);
          horizontalWordPositions.push([...currentWordPositions]);
        }
        currentWord = [];
        currentWordPositions = [];
      }
    }
    
    if (currentWord.length > 1) {
      horizontalWords.push(currentWord);
      horizontalWordPositions.push(currentWordPositions);
    }
  }
  
  // Find all vertical words
  const verticalWords = [];
  const verticalWordPositions = [];
  
  for (let col = 0; col < boardSize; col++) {
    let currentWord = [];
    let currentWordPositions = [];
    
    for (let row = 0; row < boardSize; row++) {
      if (board[row][col]) {
        currentWord.push(board[row][col]);
        currentWordPositions.push({ row, col });
      } else if (currentWord.length > 0) {
        if (currentWord.length > 1) {
          verticalWords.push([...currentWord]);
          verticalWordPositions.push([...currentWordPositions]);
        }
        currentWord = [];
        currentWordPositions = [];
      }
    }
    
    if (currentWord.length > 1) {
      verticalWords.push(currentWord);
      verticalWordPositions.push(currentWordPositions);
    }
  }
  
  // Combine all words
  const allWords = [...horizontalWords, ...verticalWords];
  const allWordPositions = [...horizontalWordPositions, ...verticalWordPositions];
  
  let totalScore = 0;
  const wordResults = [];
  
  // Process all words in parallel
  const wordPromises = allWords.map(async (word, i) => {
    const wordPositions = allWordPositions[i];
    const wordString = word.map(letter => letter.letter).join('');
    const rawScore = calculateWordScore(word, bonusTilePositions, wordPositions);
    const valid = await isValidWord(redisClient, wordString);

    const finalScore = valid ? rawScore : -rawScore;
    
    wordResults.push({
      word: wordString,
      score: finalScore,
      valid,
      positions: wordPositions
    });
    
    return finalScore;
  });
  
  // Wait for all word validations to complete
  const scores = await Promise.all(wordPromises);
  totalScore = scores.reduce((sum, score) => sum + score, 0);
  
  return {
    totalScore,
    words: wordResults
  };
};

const validateGameStateWithPuzzle = async (redisClient, gameState, puzzle, options = {}) => {
  const { allowEmptyTiles = false } = options;

  // Validate date
  if (gameState.date !== puzzle.date) {
    throw new Error('Game state date does not match today\'s date');
  }
  
  // Validate bonus tile positions
  const expectedBonusTiles = puzzle.bonusTilePositions;
  const submittedBonusTiles = gameState.bonusTilePositions;
  
  if (!expectedBonusTiles || !submittedBonusTiles) {
    throw new Error('Missing bonus tile positions');
  }
  
  // Check each bonus tile type
  const bonusTypes = ['DOUBLE_LETTER', 'TRIPLE_LETTER', 'DOUBLE_WORD', 'TRIPLE_WORD'];
  for (const type of bonusTypes) {
    if (!expectedBonusTiles[type] || !submittedBonusTiles[type]) {
      throw new Error(`Missing ${type} bonus tile position`);
    }
    
    if (expectedBonusTiles[type][0] !== submittedBonusTiles[type][0] ||
        expectedBonusTiles[type][1] !== submittedBonusTiles[type][1]) {
      throw new Error(`Incorrect ${type} bonus tile position`);
    }
  }
  
  // Validate placed tiles
  const placedTiles = gameState.placedTiles || {};
  if (!allowEmptyTiles && Object.keys(placedTiles).length === 0) {
    throw new Error('No tiles placed on board');
  }
  
  // Count letter usage
  const letterCounts = {};
  const puzzleLetters = puzzle.letters;
  
  // Initialize counts for puzzle letters
  puzzleLetters.forEach(letter => {
    const letterKey = letter.letter;
    letterCounts[letterKey] = (letterCounts[letterKey] || 0) + 1;
  });
  
  // Subtract used letters
  Object.values(placedTiles).forEach(tile => {
    const letterKey = tile.letter;
    if (!letterCounts[letterKey]) {
      throw new Error(`Invalid letter used: ${letterKey}`);
    }
    letterCounts[letterKey]--;
    if (letterCounts[letterKey] < 0) {
      throw new Error(`Too many uses of letter: ${letterKey}`);
    }
  });
  
  // Calculate score on server side
  const calculatedScore = await calculateTotalScore(redisClient, placedTiles, submittedBonusTiles);
  
  return calculatedScore;
};

const validateDailyGameState = async (redisClient, gameState, today) => {
  const puzzle = await getOrCreateDailyPuzzle(redisClient, today, {
    redisKeyPrefix: DAILY_PUZZLE_PREFIX,
    displayDate: getEasternDisplayDate()
  });
  return validateGameStateWithPuzzle(redisClient, gameState, puzzle);
};

const validateBlitzGameState = async (redisClient, gameState) => {
  const today = getEasternDateString();
  const puzzle = await getOrCreateDailyPuzzle(redisClient, today, {
    redisKeyPrefix: BLITZ_DAILY_PREFIX,
    displayDate: getEasternDisplayDate(),
    seedSecret: `${process.env.PUZZLE_SEED_SECRET || process.env.PUZZLE_SEED || ''}|blitz`
  });
  return validateGameStateWithPuzzle(redisClient, gameState, puzzle, { allowEmptyTiles: true });
};

const getWordAverageKeys = (redisKey) => ({
  avgKey: `${redisKey}${WORD_AVG_SCORE_SUFFIX}`,
  playersKey: `${redisKey}${WORD_AVG_PLAYERS_SUFFIX}`
});

const normalizeValidWordSet = (words = []) => {
  return [...new Set(
    words
      .filter((entry) => entry && entry.valid)
      .map((entry) => String(entry.word || '').toLowerCase())
      .filter(Boolean)
  )];
};

const parseWordAverageEntry = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.sumScore !== 'number' || typeof parsed.count !== 'number') {
      return null;
    }
    return parsed;
  } catch (error) {
    return null;
  }
};

const formatWordAverageEntry = (sumScore, count) => {
  if (count <= 0) return null;
  const avgScore = Number((sumScore / count).toFixed(2));
  return JSON.stringify({ sumScore, count, avgScore });
};

const applyContributionToWordAverages = async (redisClient, avgKey, contribution, deltaSign) => {
  if (!contribution || !Array.isArray(contribution.words)) return;
  const signedScore = deltaSign * Number(contribution.totalScore || 0);

  for (const word of contribution.words) {
    const wordKey = String(word || '').toLowerCase();
    if (!wordKey) continue;

    const existingRaw = await redisClient.hGet(avgKey, wordKey);
    const existing = parseWordAverageEntry(existingRaw) || { sumScore: 0, count: 0, avgScore: 0 };

    const nextSum = existing.sumScore + signedScore;
    const nextCount = existing.count + deltaSign;

    if (nextCount <= 0) {
      await redisClient.hDel(avgKey, wordKey);
      continue;
    }

    const formatted = formatWordAverageEntry(nextSum, nextCount);
    if (formatted) {
      await redisClient.hSet(avgKey, wordKey, formatted);
    }
  }
};

const updateWordAverageStatsForSubmission = async ({
  redisClient,
  redisKey,
  playerId,
  totalScore,
  words,
  ttlSeconds
}) => {
  const { avgKey, playersKey } = getWordAverageKeys(redisKey);
  const uniqueValidWords = normalizeValidWordSet(words);

  const previousRaw = await redisClient.hGet(playersKey, playerId);
  if (previousRaw) {
    try {
      const previous = JSON.parse(previousRaw);
      await applyContributionToWordAverages(redisClient, avgKey, previous, -1);
    } catch (error) {
      // Ignore malformed previous entries; overwrite with current submission.
    }
  }

  const currentContribution = {
    totalScore: Number(totalScore),
    words: uniqueValidWords
  };

  await applyContributionToWordAverages(redisClient, avgKey, currentContribution, 1);
  await redisClient.hSet(playersKey, playerId, JSON.stringify(currentContribution));

  if (ttlSeconds) {
    await redisClient.expire(avgKey, ttlSeconds);
    await redisClient.expire(playersKey, ttlSeconds);
  }
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

const buildWordBreakdownForPlayer = async ({
  redisClient,
  redisKey,
  statesKey,
  playerId,
  mode,
  puzzleId
}) => {
  const getStoredOrCalculatedWords = async (state) => {
    if (Array.isArray(state.words) && state.words.length > 0) {
      return state.words.map((entry) => ({
        word: String(entry.word || ''),
        score: Number(entry.score) || 0,
        valid: Boolean(entry.valid),
        positions: Array.isArray(entry.positions) ? entry.positions : []
      }));
    }

    const computed = await calculateTotalScore(
      redisClient,
      state.placedTiles || {},
      state.bonusTilePositions || {}
    );
    return computed.words.map((entry) => ({
      word: String(entry.word || ''),
      score: Number(entry.score) || 0,
      valid: Boolean(entry.valid),
      positions: Array.isArray(entry.positions) ? entry.positions : []
    }));
  };

  const playerStateRaw = await redisClient.hGet(statesKey, playerId);
  if (!playerStateRaw) {
    return null;
  }

  let playerState;
  try {
    playerState = JSON.parse(playerStateRaw);
  } catch (error) {
    throw new Error('Stored game state is invalid');
  }

  if (mode === 'blitz' && puzzleId && playerState.puzzleId && playerState.puzzleId !== puzzleId) {
    throw new Error('Requested puzzleId does not match player state');
  }

  const playerWords = await getStoredOrCalculatedWords(playerState);

  const allStateRows = await redisClient.hGetAll(statesKey);
  const otherPlayerWordCounts = new Map();

  for (const [otherPlayerId, stateRaw] of Object.entries(allStateRows)) {
    if (otherPlayerId === playerId) continue;

    let parsedState;
    try {
      parsedState = JSON.parse(stateRaw);
    } catch (error) {
      continue;
    }

    if (mode === 'blitz' && puzzleId && parsedState.puzzleId && parsedState.puzzleId !== puzzleId) {
      continue;
    }

    try {
      const otherWords = await getStoredOrCalculatedWords(parsedState);

      const uniqueWordsForPlayer = new Set(
        otherWords.map((wordEntry) => wordEntry.word.toLowerCase())
      );

      uniqueWordsForPlayer.forEach((word) => {
        otherPlayerWordCounts.set(word, (otherPlayerWordCounts.get(word) || 0) + 1);
      });
    } catch (error) {
      continue;
    }
  }

  const uniquePlayerWords = [...new Set(playerWords.map((entry) => entry.word.toLowerCase()))];
  const definitionMap = new Map();
  const averageMap = new Map();
  const { avgKey } = getWordAverageKeys(redisKey);

  await Promise.all(
    uniquePlayerWords.map(async (word) => {
      const definition = await getWordInfo(redisClient, word);
      definitionMap.set(word, definition);
    })
  );

  if (uniquePlayerWords.length > 0) {
    const averageEntries = await redisClient.sendCommand(['HMGET', avgKey, ...uniquePlayerWords]);
    uniquePlayerWords.forEach((word, index) => {
      const parsed = parseWordAverageEntry(averageEntries[index]);
      averageMap.set(word, parsed && typeof parsed.avgScore === 'number' ? parsed.avgScore : null);
    });
  }

  const words = playerWords.map((entry) => {
    const key = entry.word.toLowerCase();
    const playedByOthersCount = otherPlayerWordCounts.get(key) || 0;
    const score = Number(entry.score);
    const valid = Boolean(entry.valid);
    const usedBonusTypes = getUsedBonusTypesForWord(entry.positions || [], playerState.bonusTilePositions || {});
    const bonusPraise = getBonusPraiseForWord(score, usedBonusTypes, valid);
    const isHighScoringSpecial = valid && score > 50;
    const isUniqueTodaySpecial = valid && playedByOthersCount === 0;

    return {
      word: entry.word,
      score,
      valid,
      definition: definitionMap.get(key) || null,
      playedByOthersCount,
      averageScoreAmongPlayers: averageMap.get(key),
      usedBonusTypes,
      bonusPraise,
      isHighScoringSpecial,
      isUniqueTodaySpecial,
      isSpecial: isHighScoringSpecial || isUniqueTodaySpecial
    };
  });

  return {
    words,
    totalWords: words.length
  };
};

// Submit score to leaderboard
const submitScore = async (req, res) => {
  const redisClient = req.app.get('redisClient');
  
  // Check if Redis is available
  if (!redisClient || !redisClient.isOpen) {
    return res.status(503).json({ error: 'Leaderboard service unavailable' });
  }
  
  const { gameState, playerId } = req.body;
  
  if (!gameState || !playerId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const today = getEasternDateString();
  const redisKey = `${REDIS_KEY_PREFIX}${today}`;
  const statesKey = `${redisKey}:states`;
  const ttlSeconds = 60 * 60 * 36;
  
  try {
    // Validate game state and calculate score
    const { totalScore, words } = await validateDailyGameState(redisClient, gameState, today);
    
    // Store the game state in a hash using playerId as key
    const gameStateForStorage = { ...gameState, totalScore, words };
    await redisClient.hSet(statesKey, playerId, JSON.stringify(gameStateForStorage));
    
    // Add score to sorted set
    await redisClient.zAdd(redisKey, { score: totalScore, value: playerId });
    await updateWordAverageStatsForSubmission({
      redisClient,
      redisKey,
      playerId,
      totalScore,
      words,
      ttlSeconds
    });
    
    // Set expiration for both keys (36 hours to ensure it lasts through the day)
    await redisClient.expire(redisKey, ttlSeconds);
    await redisClient.expire(statesKey, ttlSeconds);
    
    // Get player's rank (using zRank with reverse order)
    const totalMembers = await redisClient.zCard(redisKey);
    const rankFromStart = await redisClient.zRank(redisKey, playerId);
    const rank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
    
    // Calculate percentile (higher is better)
    const percentile = totalMembers > 0 ? Math.round(((totalMembers - rank - 1) / totalMembers) * 100) : 100;
    
    // Get top 10 scores
    const start = Math.max(0, totalMembers - 10);
    const topScoresWithScores = await redisClient.zRangeWithScores(redisKey, start, -1);
    topScoresWithScores.reverse();
    
    // Get scores for each member
    const formattedTopScores = topScoresWithScores.map((member) => ({
      value: member.value,
      score: Number(member.score)
    }));
    
    // Check if player is in top 10
    const isInTopTen = rank !== null && rank < 10;
    
    const response = {
      rank: rank !== null ? rank + 1 : null, // Convert to 1-indexed rank
      totalScores: totalMembers,
      percentile,
      isInTopTen,
      topScores: formattedTopScores.map(item => ({
        playerId: item.value,
        score: item.score,
        isCurrentPlayer: item.value === playerId
      })),
      words // Include word results in response
    };
    res.status(200).json(response);
  } catch (error) {
    if (error.message.includes('Invalid game state') || 
        error.message.includes('Today\'s puzzle not found') ||
        error.message.includes('Game state date does not match') ||
        error.message.includes('Missing bonus tile positions') ||
        error.message.includes('Incorrect bonus tile position') ||
        error.message.includes('No tiles placed on board') ||
        error.message.includes('Invalid letter used') ||
        error.message.includes('Too many uses of letter')) {
      console.error('Game state validation error:', error);
      res.status(400).json({ error: 'Invalid game state', details: error.message });
    } else {
      console.error('Redis operation error:', error);
      res.status(500).json({ error: 'Redis operation failed', details: error.message });
    }
  }
};

// Get leaderboard
const getLeaderboard = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }
    
    const { playerId } = req.query;
    
    const today = getEasternDateString();
    const redisKey = `${REDIS_KEY_PREFIX}${today}`;
    const statesKey = `${redisKey}:states`;
    
    try {
      // Check if the sorted set exists
      const keyExists = await redisClient.exists(redisKey);
      if (!keyExists) {
        return res.status(200).json({
          scores: [],
          playerInfo: null,
          totalPlayers: 0,
          date: today
        });
      }
      
      // Get total number of members
      const totalMembers = await redisClient.zCard(redisKey);
      
      // Get all scores - get all members from the sorted set
      // Get all members and reverse the order to get highest scores first
      const allScoresWithScores = await redisClient.zRangeWithScores(redisKey, 0, -1);
      allScoresWithScores.reverse();
      
      // Get scores for each member
      const allScores = allScoresWithScores.map((member) => ({
        value: member.value,
        score: Number(member.score)
      }));
      
      // Get player's rank if playerId is provided
      let playerRank = null;
      let playerPercentile = null;
      let playerScore = null;
      
      if (playerId) {
        // Calculate reverse rank
        const rankFromStart = await redisClient.zRank(redisKey, playerId);
        playerRank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
        
        if (playerRank !== null) {
          playerRank += 1; // Convert to 1-indexed rank
          
          // Get player's score
          const scoreResult = await redisClient.zScore(redisKey, playerId);
          playerScore = scoreResult ? parseFloat(scoreResult) : null;
          
          // Calculate percentile
          const totalScores = allScores.length;
          playerPercentile = totalScores > 0 ? Math.round(((totalScores - playerRank + 1) / totalScores) * 100) : 100;
        }
      }
      
      // Get game states for the top 100 players
      const topPlayerIds = allScores.slice(0, 300).map(item => item.value);
      const gameStates = {};
      
      if (topPlayerIds.length > 0) {
        // Check if states key exists
        const statesKeyExists = await redisClient.exists(statesKey);
        
        if (statesKeyExists) {
          // Get all game states at once
          const statesData = await redisClient.hGetAll(statesKey);
          
          // Filter for only the top player IDs
          topPlayerIds.forEach(id => {
            if (statesData[id]) {
              try {
                gameStates[id] = JSON.parse(statesData[id]);
              } catch (parseError) {
                console.error(`Error parsing game state for player ${id}:`, parseError);
                gameStates[id] = null;
              }
            }
          });
        }
      }
      
      // Add player's game state if not in top 100
      if (playerId && !gameStates[playerId] && playerRank !== null) {
        const playerState = await redisClient.hGet(statesKey, playerId);
        if (playerState) {
          try {
            gameStates[playerId] = JSON.parse(playerState);
          } catch (parseError) {
            console.error(`Error parsing game state for player ${playerId}:`, parseError);
          }
        }
      }
      
      const response = {
        scores: allScores.map((item, index) => ({
          rank: index + 1,
          playerId: item.value,
          score: item.score,
          isCurrentPlayer: item.value === playerId,
          gameState: gameStates[item.value] || null
        })),
        playerInfo: playerId ? {
          rank: playerRank,
          percentile: playerPercentile,
          score: playerScore
        } : null,
        totalPlayers: allScores.length,
        date: today
      };
      res.status(200).json(response);
    } catch (redisError) {
      console.error('Redis operation error:', redisError);
      res.status(500).json({ error: 'Redis operation failed', details: redisError.message });
    }
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
};

// Get total number of scores submitted for the day
const getTotalScores = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }
    
    const today = getEasternDateString();
    const redisKey = `${REDIS_KEY_PREFIX}${today}`;
    
    try {
      // Check if the sorted set exists
      const keyExists = await redisClient.exists(redisKey);
      if (!keyExists) {
        return res.status(200).json({
          totalScores: 0,
          date: today
        });
      }
      
      // Get total number of members
      const totalMembers = await redisClient.zCard(redisKey);
      
      res.status(200).json({
        totalScores: totalMembers,
        date: today
      });
    } catch (redisError) {
      console.error('Redis operation error:', redisError);
      res.status(500).json({ error: 'Redis operation failed', details: redisError.message });
    }
  } catch (error) {
    console.error('Error getting total scores:', error);
    res.status(500).json({ error: 'Failed to get total scores' });
  }
};

const getWordBreakdown = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');

    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }

    const { playerId } = req.query;
    if (!playerId) {
      return res.status(400).json({ error: 'Missing required query parameter: playerId' });
    }

    const today = getEasternDateString();
    const redisKey = `${REDIS_KEY_PREFIX}${today}`;
    const statesKey = `${redisKey}:states`;

    const exists = await redisClient.exists(statesKey);
    if (!exists) {
      return res.status(404).json({ error: 'No game data found for today' });
    }

    const breakdown = await buildWordBreakdownForPlayer({
      redisClient,
      redisKey,
      statesKey,
      playerId,
      mode: 'daily'
    });

    if (!breakdown) {
      return res.status(404).json({ error: 'Player game state not found' });
    }

    return res.status(200).json({
      date: today,
      mode: 'daily',
      ...breakdown
    });
  } catch (error) {
    if (error.message.includes('Stored game state is invalid')) {
      return res.status(500).json({ error: 'Failed to parse stored game state' });
    }

    console.error('Error getting word breakdown:', error);
    return res.status(500).json({ error: 'Failed to get word breakdown', details: error.message });
  }
};

// Submit blitz score to leaderboard
const submitBlitzScore = async (req, res) => {
  const redisClient = req.app.get('redisClient');
  
  // Check if Redis is available
  if (!redisClient || !redisClient.isOpen) {
    return res.status(503).json({ error: 'Leaderboard service unavailable' });
  }
  
  const { gameState, playerId } = req.body;
  
  if (!gameState || !playerId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const today = getEasternDateString();
  const redisKey = `${BLITZ_LEADERBOARD_PREFIX}${today}`;
  const statesKey = `${redisKey}:states`;
  const ttlSeconds = 60 * 60 * 36;
  
  try {
    // Validate game state and calculate score
    const { totalScore, words } = await validateBlitzGameState(redisClient, gameState);
    
    // Store the game state in a hash using playerId as key
    const gameStateForStorage = { ...gameState, totalScore, words };
    await redisClient.hSet(statesKey, playerId, JSON.stringify(gameStateForStorage));
    
    // Add score to sorted set
    await redisClient.zAdd(redisKey, { score: totalScore, value: playerId });
    await updateWordAverageStatsForSubmission({
      redisClient,
      redisKey,
      playerId,
      totalScore,
      words,
      ttlSeconds
    });
    
    // Set expiration for both keys (36 hours to ensure it lasts through the day)
    await redisClient.expire(redisKey, ttlSeconds);
    await redisClient.expire(statesKey, ttlSeconds);
    
    // Get player's rank (using zRank with reverse order)
    const totalMembers = await redisClient.zCard(redisKey);
    const rankFromStart = await redisClient.zRank(redisKey, playerId);
    const rank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
    
    // Calculate percentile (higher is better)
    const percentile = totalMembers > 0 ? Math.round(((totalMembers - rank - 1) / totalMembers) * 100) : 100;
    
    // Get top 10 scores
    const start = Math.max(0, totalMembers - 10);
    const topScoresWithScores = await redisClient.zRangeWithScores(redisKey, start, -1);
    topScoresWithScores.reverse();
    
    // Get scores for each member
    const formattedTopScores = topScoresWithScores.map((member) => ({
      value: member.value,
      score: Number(member.score)
    }));
    
    // Check if player is in top 10
    const isInTopTen = rank !== null && rank < 10;
    
    const response = {
      rank: rank !== null ? rank + 1 : null, // Convert to 1-indexed rank
      totalScores: totalMembers,
      percentile,
      isInTopTen,
      topScores: formattedTopScores.map(item => ({
        playerId: item.value,
        score: item.score,
        isCurrentPlayer: item.value === playerId
      })),
      words // Include word results in response
    };
    res.status(200).json(response);
  } catch (error) {
    if (error.message.includes('Game state date does not match') ||
        error.message.includes('Missing bonus tile positions') ||
        error.message.includes('Incorrect bonus tile position') ||
        error.message.includes('Invalid letter used') ||
        error.message.includes('Too many uses of letter')) {
      console.error('Game state validation error:', error);
      res.status(400).json({ error: 'Invalid game state', details: error.message });
    } else {
      console.error('Redis operation error:', error);
      res.status(500).json({ error: 'Redis operation failed', details: error.message });
    }
  }
};

// Get blitz leaderboard
const getBlitzLeaderboard = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }
    
    const { playerId } = req.query;
    
    const today = getEasternDateString();
    const redisKey = `${BLITZ_LEADERBOARD_PREFIX}${today}`;
    const statesKey = `${redisKey}:states`;
    
    try {
      // Check if the sorted set exists
      const keyExists = await redisClient.exists(redisKey);
      if (!keyExists) {
        return res.status(200).json({
          scores: [],
          playerInfo: null,
          totalPlayers: 0,
          date: today
        });
      }
      
      // Get total number of members
      const totalMembers = await redisClient.zCard(redisKey);
      
      // Get all scores - get all members from the sorted set
      // Get all members and reverse the order to get highest scores first
      const allScoresWithScores = await redisClient.zRangeWithScores(redisKey, 0, -1);
      allScoresWithScores.reverse();
      
      // Get scores for each member
      const allScores = allScoresWithScores.map((member) => ({
        value: member.value,
        score: Number(member.score)
      }));
      
      // Get player's rank if playerId is provided
      let playerRank = null;
      let playerPercentile = null;
      let playerScore = null;
      
      if (playerId) {
        // Calculate reverse rank
        const rankFromStart = await redisClient.zRank(redisKey, playerId);
        playerRank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
        
        if (playerRank !== null) {
          playerRank += 1; // Convert to 1-indexed rank
          
          // Get player's score
          const scoreResult = await redisClient.zScore(redisKey, playerId);
          playerScore = scoreResult ? parseFloat(scoreResult) : null;
          
          // Calculate percentile
          const totalScores = allScores.length;
          playerPercentile = totalScores > 0 ? Math.round(((totalScores - playerRank + 1) / totalScores) * 100) : 100;
        }
      }
      
      // Get game states for the top 300 players
      const topPlayerIds = allScores.slice(0, 300).map(item => item.value);
      const gameStates = {};
      
      if (topPlayerIds.length > 0) {
        // Check if states key exists
        const statesKeyExists = await redisClient.exists(statesKey);
        
        if (statesKeyExists) {
          // Get all game states at once
          const statesData = await redisClient.hGetAll(statesKey);
          
          // Filter for only the top player IDs
          topPlayerIds.forEach(id => {
            if (statesData[id]) {
              try {
                gameStates[id] = JSON.parse(statesData[id]);
              } catch (parseError) {
                console.error(`Error parsing game state for player ${id}:`, parseError);
                gameStates[id] = null;
              }
            }
          });
        }
      }
      
      // Add player's game state if not in top 300
      if (playerId && !gameStates[playerId] && playerRank !== null) {
        const playerState = await redisClient.hGet(statesKey, playerId);
        if (playerState) {
          try {
            gameStates[playerId] = JSON.parse(playerState);
          } catch (parseError) {
            console.error(`Error parsing game state for player ${playerId}:`, parseError);
          }
        }
      }
      
      const response = {
        scores: allScores.map((item, index) => ({
          rank: index + 1,
          playerId: item.value,
          score: item.score,
          isCurrentPlayer: item.value === playerId,
          gameState: gameStates[item.value] || null
        })),
        playerInfo: playerId ? {
          rank: playerRank,
          percentile: playerPercentile,
          score: playerScore
        } : null,
        totalPlayers: allScores.length,
        date: today
      };
      res.status(200).json(response);
    } catch (redisError) {
      console.error('Redis operation error:', redisError);
      res.status(500).json({ error: 'Redis operation failed', details: redisError.message });
    }
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
};

// Get total number of blitz scores submitted for the day
const getBlitzTotalScores = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }
    
    const today = getEasternDateString();
    const redisKey = `${BLITZ_LEADERBOARD_PREFIX}${today}`;
    
    try {
      // Check if the sorted set exists
      const keyExists = await redisClient.exists(redisKey);
      if (!keyExists) {
        return res.status(200).json({
          totalScores: 0,
          date: today
        });
      }
      
      // Get total number of members
      const totalMembers = await redisClient.zCard(redisKey);
      
      res.status(200).json({
        totalScores: totalMembers,
        date: today
      });
    } catch (redisError) {
      console.error('Redis operation error:', redisError);
      res.status(500).json({ error: 'Redis operation failed', details: redisError.message });
    }
  } catch (error) {
    console.error('Error getting total scores:', error);
    res.status(500).json({ error: 'Failed to get total scores' });
  }
};

const getBlitzWordBreakdown = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');

    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }

    const { playerId, puzzleId } = req.query;
    if (!playerId) {
      return res.status(400).json({ error: 'Missing required query parameter: playerId' });
    }

    const today = getEasternDateString();
    const effectivePuzzleId = puzzleId || today;
    const redisKey = `${BLITZ_LEADERBOARD_PREFIX}${today}`;
    const statesKey = `${redisKey}:states`;

    const exists = await redisClient.exists(statesKey);
    if (!exists) {
      return res.status(404).json({ error: 'No blitz game data found for today' });
    }

    const breakdown = await buildWordBreakdownForPlayer({
      redisClient,
      redisKey,
      statesKey,
      playerId,
      mode: 'blitz',
      puzzleId: effectivePuzzleId
    });

    if (!breakdown) {
      return res.status(404).json({ error: 'Player blitz game state not found' });
    }

    return res.status(200).json({
      date: today,
      mode: 'blitz',
      puzzleId: effectivePuzzleId,
      ...breakdown
    });
  } catch (error) {
    if (error.message.includes('Requested puzzleId does not match player state')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes('Stored game state is invalid')) {
      return res.status(500).json({ error: 'Failed to parse stored game state' });
    }

    console.error('Error getting blitz word breakdown:', error);
    return res.status(500).json({ error: 'Failed to get blitz word breakdown', details: error.message });
  }
};

module.exports = { 
  submitScore, 
  getLeaderboard, 
  getTotalScores,
  getWordBreakdown,
  submitBlitzScore,
  getBlitzLeaderboard,
  getBlitzTotalScores,
  getBlitzWordBreakdown,
  initializeDictionary,
  getWordInfo
}; 
