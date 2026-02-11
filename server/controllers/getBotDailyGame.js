const { getEasternDateString } = require('../lib/dailyPuzzle');
const { BOT_DAILY_RESULT_PREFIX, BOT_DAILY_RESULT_LATEST_KEY } = require('../lib/botDailyWorker');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const getBotDailyGame = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    const queryDate = typeof req.query?.date === 'string' ? req.query.date.trim() : '';
    const hasExplicitDate = DATE_RE.test(queryDate);
    const date = hasExplicitDate ? queryDate : getEasternDateString();
    const dailyKey = `${BOT_DAILY_RESULT_PREFIX}${date}`;

    let payloadRaw = await redisClient.get(dailyKey);
    let sourceKey = dailyKey;

    if (!payloadRaw && !hasExplicitDate) {
      payloadRaw = await redisClient.get(BOT_DAILY_RESULT_LATEST_KEY);
      sourceKey = BOT_DAILY_RESULT_LATEST_KEY;
    }

    if (!payloadRaw) {
      return res.status(404).json({
        error: 'Bot game not available yet',
        date
      });
    }

    let payload;
    try {
      payload = JSON.parse(payloadRaw);
    } catch (error) {
      return res.status(500).json({
        error: 'Stored bot game payload is invalid JSON'
      });
    }

    return res.status(200).json({
      ...payload,
      sourceKey
    });
  } catch (error) {
    console.error('Error getting bot daily game:', error);
    return res.status(500).json({ error: 'Failed to get bot daily game' });
  }
};

module.exports = { getBotDailyGame };
