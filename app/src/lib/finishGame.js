// Function to calculate the score of a word based on letter points and bonus tiles
const calculateWordScore = (word, letterPoints, bonusTiles, wordPositions) => {
  let wordScore = 0;
  let wordMultiplier = 1;
  
  // Calculate score for each letter, considering bonus tiles
  word.forEach((letter, index) => {
    const position = wordPositions[index];
    const letterScore = letter.points;
    
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

// Function to check if a word is valid using the dictionary
const isValidWord = async (word) => {
  try {
    // Fetch the dictionary file
    const response = await fetch('/dictionary.txt');
    const text = await response.text();
    
    // Split the dictionary into an array of words
    const dictionary = text.toLowerCase().split('\n').map(word => word.trim());
    
    // Check if the word is in the dictionary
    return dictionary.includes(word.toLowerCase());
  } catch (error) {
    console.error('Error loading dictionary:', error);
    return false;
  }
};

// Main function to analyze the board and calculate scores
const finishGame = async (gameState) => {
  const { placedTiles, bonusTilePositions, letterPoints } = gameState;
  const boardSize = 5; // Assuming a 5x5 board
  
  // Create a 2D array representation of the board
  const board = Array(boardSize).fill().map(() => Array(boardSize).fill(null));
  
  // Fill the board with placed tiles
  Object.entries(placedTiles).forEach(([position, letter]) => {
    const [row, col] = position.split('-').map(Number);
    board[row][col] = letter;
  });
  
  // Find all horizontal words (left to right)
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
        // End of a word
        if (currentWord.length > 1) {
          horizontalWords.push([...currentWord]);
          horizontalWordPositions.push([...currentWordPositions]);
        }
        currentWord = [];
        currentWordPositions = [];
      }
    }
    
    // Check for word at the end of the row
    if (currentWord.length > 1) {
      horizontalWords.push(currentWord);
      horizontalWordPositions.push(currentWordPositions);
    }
  }
  
  // Find all vertical words (top to bottom)
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
        // End of a word
        if (currentWord.length > 1) {
          verticalWords.push([...currentWord]);
          verticalWordPositions.push([...currentWordPositions]);
        }
        currentWord = [];
        currentWordPositions = [];
      }
    }
    
    // Check for word at the end of the column
    if (currentWord.length > 1) {
      verticalWords.push(currentWord);
      verticalWordPositions.push(currentWordPositions);
    }
  }
  
  // Combine all words and their positions
  const allWords = [...horizontalWords, ...verticalWords];
  const allWordPositions = [...horizontalWordPositions, ...verticalWordPositions];
  
  // Calculate scores for each word and check validity
  const results = [];
  let totalScore = 0;
  
  for (let i = 0; i < allWords.length; i++) {
    const word = allWords[i];
    const wordPositions = allWordPositions[i];
    
    // Convert the word array to a string
    const wordString = word.map(letter => letter.letter).join('');
    
    // Calculate the raw score
    const rawScore = calculateWordScore(word, letterPoints, bonusTilePositions, wordPositions);
    
    // Check if the word is valid
    const valid = await isValidWord(wordString);
    
    // Calculate the final score (negative if invalid)
    const finalScore = valid ? rawScore : -rawScore;
    
    // Add to total score
    totalScore += finalScore;
    
    // Add to results
    results.push({
      word: wordString,
      score: finalScore,
      valid,
      positions: wordPositions
    });
  }
  
  return {
    totalScore,
    words: results
  };
};

export default finishGame;