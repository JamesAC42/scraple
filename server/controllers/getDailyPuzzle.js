const { createClient } = require('redis');

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

// Function to generate random letters with points
const generateRandomLetters = () => {
  // Group letters by frequency (more common letters should appear more often)
  const vowels = [
    { letter: 'A', weight: 9 },
    { letter: 'E', weight: 12 },
    { letter: 'I', weight: 9 },
    { letter: 'O', weight: 8 },
    { letter: 'U', weight: 4 }
  ];
  
  const consonants = [
    { letter: 'B', weight: 2 },
    { letter: 'C', weight: 2 },
    { letter: 'D', weight: 4 },
    { letter: 'F', weight: 2 },
    { letter: 'G', weight: 3 },
    { letter: 'H', weight: 2 },
    { letter: 'J', weight: 1 },
    { letter: 'K', weight: 1 },
    { letter: 'L', weight: 4 },
    { letter: 'M', weight: 2 },
    { letter: 'N', weight: 6 },
    { letter: 'P', weight: 2 },
    { letter: 'Q', weight: 1 },
    { letter: 'R', weight: 6 },
    { letter: 'S', weight: 4 },
    { letter: 'T', weight: 6 },
    { letter: 'V', weight: 2 },
    { letter: 'W', weight: 2 },
    { letter: 'X', weight: 1 },
    { letter: 'Y', weight: 2 },
    { letter: 'Z', weight: 1 }
  ];
  
  // Weighted random selection function
  const getWeightedRandomItem = (items) => {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const item of items) {
      random -= item.weight;
      if (random <= 0) {
        return item.letter;
      }
    }
    
    return items[0].letter; // Fallback
  };
  
  // Get 8 random vowels
  const randomVowels = Array.from({ length: 8 }, () => {
    const letter = getWeightedRandomItem(vowels);
    const points = letterPoints[letter];
    return {
      letter,
      points
    };
  });
  
  // Get 10 random consonants
  const randomConsonants = Array.from({ length: 10 }, () => {
    const letter = getWeightedRandomItem(consonants);
    const points = letterPoints[letter];
    return {
      letter,
      points
    };
  });
  
  // Combine and shuffle the letters
  const allLetters = [...randomVowels, ...randomConsonants];
  
  // Fisher-Yates shuffle algorithm
  for (let i = allLetters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allLetters[i], allLetters[j]] = [allLetters[j], allLetters[i]];
  }
  return allLetters;
};

// Generate random bonus tile positions for a 5x5 board
const generateBonusTilePositions = () => {
  const boardSize = 5;
  const positions = [];
  const usedPositions = new Set();
  
  // Define bonus types
  const bonusTypes = [
    'DOUBLE_LETTER',
    'TRIPLE_LETTER',
    'DOUBLE_WORD',
    'TRIPLE_WORD'
  ];
  
  const bonusTilePositions = {};
  
  // Generate a random position for each bonus type
  bonusTypes.forEach(type => {
    let row, col, posKey;
    
    // Keep generating until we find an unused position
    do {
      row = Math.floor(Math.random() * boardSize);
      col = Math.floor(Math.random() * boardSize);
      posKey = `${row}-${col}`;
    } while (usedPositions.has(posKey));
    
    // Mark this position as used
    usedPositions.add(posKey);
    
    // Store the position for this bonus type
    bonusTilePositions[type] = [row, col];
  });
  
  return bonusTilePositions;
};

// Format date as YYYY-MM-DD
const getFormattedDate = () => {
  // Create date in Eastern Time
  const date = new Date();
  const options = { timeZone: 'America/New_York' };
  const etDate = new Date(date.toLocaleString('en-US', options));
  return etDate.toISOString().split('T')[0];
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

// Redis key for storing the daily puzzle
const REDIS_KEY_PREFIX = 'scraple:daily:';

// Get daily puzzle controller
const getDailyPuzzle = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    let dailyPuzzle = null;
    
    // Check if Redis is available
    if (!redisClient || !redisClient.isOpen) {
      console.warn('Redis client not available, generating fallback puzzle');
    } else {
      const today = getFormattedDate();
      const redisKey = `${REDIS_KEY_PREFIX}${today}`;
      
      // Try to get today's puzzle from Redis
      dailyPuzzle = await redisClient.get(redisKey);
      
      if (!dailyPuzzle && redisClient.isOpen) {
        // Generate a new puzzle if none exists for today
        const newPuzzle = {
          letters: generateRandomLetters(),
          bonusTilePositions: generateBonusTilePositions(),
          date: today,
          displayDate: getDisplayDate()
        };
        
        try {
          // Store in Redis with expiration (3 days to be safe)
          await redisClient.set(redisKey, JSON.stringify(newPuzzle), {
            EX: 60 * 60 * 24 * 3 // 3 days in seconds
          });
        } catch (redisError) {
          console.error('Error storing puzzle in Redis:', redisError);
        }
        
        dailyPuzzle = JSON.stringify(newPuzzle);
      }
    }
    
    // If we still don't have a puzzle (Redis unavailable), generate a fallback
    if (!dailyPuzzle) {
      const fallbackPuzzle = {
        letters: generateRandomLetters(),
        bonusTilePositions: generateBonusTilePositions(),
        date: getFormattedDate(),
        displayDate: getDisplayDate()
      };
      
      dailyPuzzle = JSON.stringify(fallbackPuzzle);
    }
    
    res.status(200).json(JSON.parse(dailyPuzzle));
  } catch (error) {
    console.error('Error getting daily puzzle:', error);
    
    // Generate a fallback puzzle in case of any error
    const fallbackPuzzle = {
      letters: generateRandomLetters(),
      bonusTilePositions: generateBonusTilePositions(),
      date: getFormattedDate(),
      displayDate: getDisplayDate()
    };
    
    res.status(200).json(fallbackPuzzle);
  }
};

module.exports = { getDailyPuzzle };
