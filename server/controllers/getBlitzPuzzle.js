const { getEasternDateString, getEasternDisplayDate, getOrCreateDailyPuzzle } = require('../lib/dailyPuzzle');

const BLITZ_DAILY_PREFIX = 'scraple:blitz:daily:';

// Get blitz puzzle controller (randomized puzzle per request)
const getBlitzPuzzle = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    const today = getEasternDateString();
    const displayDate = getEasternDisplayDate();

    const puzzle = await getOrCreateDailyPuzzle(redisClient, today, {
      redisKeyPrefix: BLITZ_DAILY_PREFIX,
      displayDate,
      seedSecret: `${process.env.PUZZLE_SEED_SECRET || process.env.PUZZLE_SEED || ''}|blitz`
    });

    res.status(200).json({
      ...puzzle,
      puzzleId: today,
      mode: 'blitz'
    });
  } catch (error) {
    console.error('Error getting blitz puzzle:', error);
    res.status(500).json({ error: 'Failed to get blitz puzzle' });
  }
};

module.exports = { getBlitzPuzzle };

