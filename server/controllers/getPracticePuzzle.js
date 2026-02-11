const { randomUUID } = require('crypto');
const { getEasternDateString, generateRandomPuzzle } = require('../lib/dailyPuzzle');

const getPracticePuzzle = async (req, res) => {
  try {
    const today = getEasternDateString();
    const puzzle = generateRandomPuzzle({
      dateString: today,
      displayDate: 'Practice Game'
    });

    res.status(200).json({
      ...puzzle,
      displayDate: 'Practice Game',
      puzzleId: `practice-${randomUUID()}`,
      mode: 'practice'
    });
  } catch (error) {
    console.error('Error getting practice puzzle:', error);
    res.status(500).json({ error: 'Failed to get practice puzzle' });
  }
};

module.exports = { getPracticePuzzle };
