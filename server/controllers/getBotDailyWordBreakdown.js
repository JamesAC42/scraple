const { getEasternDateString } = require('../lib/dailyPuzzle');
const { BOT_DAILY_RESULT_PREFIX, BOT_DAILY_RESULT_LATEST_KEY } = require('../lib/botDailyWorker');
const { getWordInfo } = require('./leaderboard');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_LEADERBOARD_PREFIX = 'scraple:leaderboard:';
const WORD_AVG_SCORE_SUFFIX = ':word-avg-score';

const parseWordAverageEntry = (value) => {
  if (!value) return null;
  const raw = String(value);

  // Current format shared by leaderboard stats.
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.avgScore === 'number' && Number.isFinite(parsed.avgScore)) {
      return { avgScore: parsed.avgScore };
    }
  } catch (_) {
    // Fall through to legacy parsing.
  }

  // Legacy format: "<avg>|..."
  const [avgRaw] = raw.split('|');
  const avgScore = Number.parseFloat(avgRaw);
  if (!Number.isFinite(avgScore)) return null;
  return { avgScore };
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

const getBotPayloadForDate = async (redisClient, queryDate) => {
  const hasExplicitDate = DATE_RE.test(queryDate || '');
  const date = hasExplicitDate ? queryDate : getEasternDateString();
  const dailyKey = `${BOT_DAILY_RESULT_PREFIX}${date}`;

  let payloadRaw = await redisClient.get(dailyKey);
  if (!payloadRaw && !hasExplicitDate) {
    payloadRaw = await redisClient.get(BOT_DAILY_RESULT_LATEST_KEY);
  }
  if (!payloadRaw) return null;

  try {
    const payload = JSON.parse(payloadRaw);
    return { payload, date: payload.date || date };
  } catch (_) {
    return null;
  }
};

const getBotDailyWordBreakdown = async (req, res) => {
  try {
    const redisClient = req.app.get('redisClient');
    if (!redisClient || !redisClient.isOpen) {
      return res.status(503).json({ error: 'Leaderboard service unavailable' });
    }

    const queryDate = typeof req.query?.date === 'string' ? req.query.date.trim() : '';
    const botData = await getBotPayloadForDate(redisClient, queryDate);
    if (!botData || !botData.payload) {
      return res.status(404).json({ error: 'Bot game not available yet' });
    }

    const { payload, date } = botData;
    const normalizedWords = Array.isArray(payload.words)
      ? payload.words.map((entry) => ({
          word: String(entry?.word || ''),
          score: Number(entry?.score) || 0,
          valid: entry?.valid !== false,
          positions: Array.isArray(entry?.positions) ? entry.positions : []
        }))
      : [];

    if (normalizedWords.length === 0) {
      return res.status(200).json({
        date,
        words: [],
        totalWords: 0
      });
    }

    const statesKey = `${DAILY_LEADERBOARD_PREFIX}${date}:states`;
    const redisKey = `${DAILY_LEADERBOARD_PREFIX}${date}`;
    const avgKey = `${redisKey}${WORD_AVG_SCORE_SUFFIX}`;
    const allStateRows = await redisClient.hGetAll(statesKey);
    const otherPlayerWordCounts = new Map();

    for (const stateRaw of Object.values(allStateRows || {})) {
      let parsedState;
      try {
        parsedState = JSON.parse(stateRaw);
      } catch (_) {
        continue;
      }
      const stateWords = Array.isArray(parsedState?.words) ? parsedState.words : [];
      const uniqueWordsForPlayer = new Set(
        stateWords
          .map((wordEntry) => String(wordEntry?.word || '').toLowerCase())
          .filter(Boolean)
      );
      uniqueWordsForPlayer.forEach((word) => {
        otherPlayerWordCounts.set(word, (otherPlayerWordCounts.get(word) || 0) + 1);
      });
    }

    const uniqueBotWords = [...new Set(normalizedWords.map((entry) => entry.word.toLowerCase()).filter(Boolean))];
    const definitionMap = new Map();
    const averageMap = new Map();

    await Promise.all(
      uniqueBotWords.map(async (word) => {
        const definition = await getWordInfo(redisClient, word);
        definitionMap.set(word, definition);
      })
    );

    if (uniqueBotWords.length > 0) {
      const averageEntries = await redisClient.sendCommand(['HMGET', avgKey, ...uniqueBotWords]);
      uniqueBotWords.forEach((word, index) => {
        const parsed = parseWordAverageEntry(averageEntries[index]);
        averageMap.set(word, parsed && typeof parsed.avgScore === 'number' ? parsed.avgScore : null);
      });
    }

    const words = normalizedWords.map((entry) => {
      const key = entry.word.toLowerCase();
      const playedByOthersCount = otherPlayerWordCounts.get(key) || 0;
      const usedBonusTypes = getUsedBonusTypesForWord(entry.positions || [], payload.bonusTilePositions || {});
      const bonusPraise = getBonusPraiseForWord(entry.score, usedBonusTypes, entry.valid);
      const isHighScoringSpecial = entry.valid && entry.score > 50;
      const isUniqueTodaySpecial = entry.valid && playedByOthersCount === 0;

      return {
        word: entry.word,
        score: entry.score,
        valid: entry.valid,
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

    return res.status(200).json({
      date,
      words,
      totalWords: words.length
    });
  } catch (error) {
    console.error('Error getting bot daily word breakdown:', error);
    return res.status(500).json({ error: 'Failed to get bot daily word breakdown' });
  }
};

module.exports = { getBotDailyWordBreakdown };
