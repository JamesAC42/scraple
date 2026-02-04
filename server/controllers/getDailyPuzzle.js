const { getEasternDateString, getEasternDisplayDate, getOrCreateDailyPuzzle } = require('../lib/dailyPuzzle');

// Redis key for storing the daily puzzle
const REDIS_KEY_PREFIX = 'scraple:daily:';

// Get daily puzzle controller
const getDailyPuzzle = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    const today = getEasternDateString();

    const puzzle = await getOrCreateDailyPuzzle(redisClient, today, {
      redisKeyPrefix: REDIS_KEY_PREFIX,
      displayDate: getEasternDisplayDate()
    });

    res.status(200).json(puzzle);
  } catch (error) {
    console.error('Error getting daily puzzle:', error);

    // Still respond with a deterministic puzzle even on error.
    const today = getEasternDateString();
    const puzzle = await getOrCreateDailyPuzzle(null, today, {
      redisKeyPrefix: REDIS_KEY_PREFIX,
      displayDate: getEasternDisplayDate(),
      writeToRedis: false
    });
    res.status(200).json(puzzle);
  }
};

module.exports = { getDailyPuzzle };
