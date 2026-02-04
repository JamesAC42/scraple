// Deterministic daily puzzle generator (seeded by date) so restarts can't create a different puzzle.

// Letter points mapping
const letterPoints = {
  A: 1, E: 1, I: 1, L: 1, N: 1, O: 1, R: 1, S: 1, T: 1, U: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10,
  '': 0 // Blank tile
};

// xmur3 string hash -> returns a function that yields a 32-bit unsigned integer
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// mulberry32 PRNG -> returns float in [0, 1)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRng(seedString) {
  const seed = xmur3(seedString)();
  return mulberry32(seed);
}

// Format date as YYYY-MM-DD in Eastern Time
function getEasternDateString(date = new Date()) {
  const options = { timeZone: 'America/New_York' };
  const etDate = new Date(date.toLocaleString('en-US', options));
  return etDate.toISOString().split('T')[0];
}

// Format date for display (Month Day, Year) in Eastern Time
function getEasternDisplayDate(date = new Date()) {
  const options = {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  };
  return date.toLocaleString('en-US', options);
}

function generateRandomLetters(rng) {
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

  const getWeightedRandomItem = (items) => {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = rng() * totalWeight;
    for (const item of items) {
      random -= item.weight;
      if (random <= 0) return item.letter;
    }
    return items[0].letter; // Fallback
  };

  // Get 8 random vowels
  const randomVowels = Array.from({ length: 8 }, () => {
    const letter = getWeightedRandomItem(vowels);
    return { letter, points: letterPoints[letter] };
  });

  // Get 10 random consonants
  const randomConsonants = Array.from({ length: 10 }, () => {
    const letter = getWeightedRandomItem(consonants);
    return { letter, points: letterPoints[letter] };
  });

  // Combine and shuffle the letters (seeded)
  const allLetters = [...randomVowels, ...randomConsonants];
  for (let i = allLetters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allLetters[i], allLetters[j]] = [allLetters[j], allLetters[i]];
  }

  return allLetters;
}

function generateBonusTilePositions(rng) {
  const boardSize = 5;
  const usedPositions = new Set();

  const bonusTypes = [
    'DOUBLE_LETTER',
    'TRIPLE_LETTER',
    'DOUBLE_WORD',
    'TRIPLE_WORD'
  ];

  const bonusTilePositions = {};
  for (const type of bonusTypes) {
    let row, col, posKey;
    do {
      row = Math.floor(rng() * boardSize);
      col = Math.floor(rng() * boardSize);
      posKey = `${row}-${col}`;
    } while (usedPositions.has(posKey));
    usedPositions.add(posKey);
    bonusTilePositions[type] = [row, col];
  }

  return bonusTilePositions;
}

/**
 * Pure puzzle generator (no Redis). Supply an RNG for deterministic generation if needed.
 * rng should be a function returning a float in [0, 1).
 */
function generatePuzzle({ rng = Math.random, dateString, displayDate }) {
  if (typeof rng !== 'function') {
    throw new Error('generatePuzzle: rng must be a function');
  }
  return {
    letters: generateRandomLetters(rng),
    bonusTilePositions: generateBonusTilePositions(rng),
    date: dateString,
    displayDate
  };
}

function generateRandomPuzzle({ dateString, displayDate } = {}) {
  return generatePuzzle({ rng: Math.random, dateString, displayDate });
}

function generateDeterministicPuzzleForDate(dateString, displayDate, seedSecret = '') {
  const seedBasis = `scraple|${dateString}|${seedSecret || ''}`;
  const rng = createSeededRng(seedBasis);
  return generatePuzzle({ rng, dateString, displayDate });
}

async function getOrCreateDailyPuzzle(redisClient, dateString, options = {}) {
  const {
    redisKeyPrefix = 'scraple:daily:',
    ttlSeconds = 60 * 60 * 24 * 3, // 3 days
    seedSecret = process.env.PUZZLE_SEED_SECRET || process.env.PUZZLE_SEED || '',
    displayDate = getEasternDisplayDate(),
    writeToRedis = true
  } = options;

  const redisKey = `${redisKeyPrefix}${dateString}`;

  // If Redis is unavailable, just generate deterministically.
  if (!redisClient || !redisClient.isOpen) {
    return generateDeterministicPuzzleForDate(dateString, displayDate, seedSecret);
  }

  const existing = await redisClient.get(redisKey);
  if (existing) return JSON.parse(existing);

  const puzzle = generateDeterministicPuzzleForDate(dateString, displayDate, seedSecret);

  if (writeToRedis) {
    try {
      await redisClient.set(redisKey, JSON.stringify(puzzle), { EX: ttlSeconds });
    } catch (err) {
      // Non-fatal: deterministic generation still ensures consistency for the day.
      console.error('Error storing puzzle in Redis:', err);
    }
  }

  return puzzle;
}

module.exports = {
  getEasternDateString,
  getEasternDisplayDate,
  getOrCreateDailyPuzzle,
  generatePuzzle,
  generateRandomPuzzle,
  generateDeterministicPuzzleForDate,
  // Backwards-compat export (older name)
  buildDeterministicPuzzleForDate: generateDeterministicPuzzleForDate
};


