const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

// Format date as YYYY-MM-DD in Eastern Time
const getFormattedDate = () => {
  const date = new Date();
  const options = { timeZone: 'America/New_York' };
  const etDate = new Date(date.toLocaleString('en-US', options));
  return etDate.toISOString().split('T')[0];
};

// Redis key for storing the daily leaderboard
const REDIS_KEY_PREFIX = 'scraple:leaderboard:';
const DAILY_PUZZLE_PREFIX = 'scraple:daily:';
const DICTIONARY_KEY = 'scraple:dictionary';

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

// Function to initialize dictionary in Redis if it doesn't exist
const initializeDictionary = async (redisClient) => {
  try {
    // Check if dictionary exists in Redis
    const exists = await redisClient.exists(DICTIONARY_KEY);
    if (exists) {
      return; // Dictionary already initialized
    }

    // Read dictionary file
    const dictionaryPath = path.join(__dirname, '..', 'dictionary.txt');
    const dictionaryContent = fs.readFileSync(dictionaryPath, 'utf8');
    const words = dictionaryContent.split('\n').map(word => word.trim().toLowerCase());

    // Add words to Redis set
    if (words.length > 0) {
      await redisClient.sAdd(DICTIONARY_KEY, words);
      console.log(`Initialized dictionary with ${words.length} words`);
    }
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
    
    // Check if word exists in Redis set
    return await redisClient.sIsMember(DICTIONARY_KEY, word.toLowerCase());
  } catch (error) {
    console.error('Error checking word validity:', error);
    return false;
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

// Function to validate game state against today's puzzle
const validateGameState = async (redisClient, gameState, today) => {
  // Get today's puzzle
  const puzzleKey = `${DAILY_PUZZLE_PREFIX}${today}`;
  const puzzleData = await redisClient.get(puzzleKey);
  
  if (!puzzleData) {
    throw new Error('Today\'s puzzle not found');
  }
  
  const puzzle = JSON.parse(puzzleData);
  
  // Validate date
  if (gameState.date !== today) {
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
  const placedTiles = gameState.placedTiles;
  if (!placedTiles) {
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
  
  const today = getFormattedDate();
  const redisKey = `${REDIS_KEY_PREFIX}${today}`;
  const statesKey = `${redisKey}:states`;
  
  try {
    // Validate game state and calculate score
    const { totalScore, words } = await validateGameState(redisClient, gameState, today);
    
    // Store the game state in a hash using playerId as key
    await redisClient.hSet(statesKey, playerId, JSON.stringify(gameState));
    
    // Add score to sorted set
    await redisClient.zAdd(redisKey, { score: totalScore, value: playerId });
    
    // Set expiration for both keys (36 hours to ensure it lasts through the day)
    await redisClient.expire(redisKey, 60 * 60 * 36);
    await redisClient.expire(statesKey, 60 * 60 * 36);
    
    // Get player's rank (using zRank with reverse order)
    const totalMembers = await redisClient.zCard(redisKey);
    const rankFromStart = await redisClient.zRank(redisKey, playerId);
    const rank = rankFromStart !== null ? (totalMembers - 1) - rankFromStart : null;
    
    // Calculate percentile (higher is better)
    const percentile = totalMembers > 0 ? Math.round(((totalMembers - rank - 1) / totalMembers) * 100) : 100;
    
    // Get top 10 scores
    const start = Math.max(0, totalMembers - 10);
    const topScoresMembers = await redisClient.zRange(redisKey, start, -1);
    topScoresMembers.reverse();
    
    // Get scores for each member
    const formattedTopScores = [];
    for (const member of topScoresMembers) {
      const memberScore = await redisClient.zScore(redisKey, member);
      formattedTopScores.push({
        value: member,
        score: parseFloat(memberScore)
      });
    }
    
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
    
    const today = getFormattedDate();
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
      const allScoresMembers = await redisClient.zRange(redisKey, 0, -1);
      allScoresMembers.reverse();
      
      // Get scores for each member
      const allScores = [];
      for (const member of allScoresMembers) {
        const memberScore = await redisClient.zScore(redisKey, member);
        allScores.push({
          value: member,
          score: parseFloat(memberScore)
        });
      }
      
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
    
    const today = getFormattedDate();
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

module.exports = { submitScore, getLeaderboard, getTotalScores }; 