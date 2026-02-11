const fs = require('fs');
const path = require('path');

let dictionaryDefinitionMap = null;

const getDictionaryDefinitionMap = () => {
  if (dictionaryDefinitionMap) return dictionaryDefinitionMap;

  const nextMap = new Map();
  try {
    const dictionaryPath = path.join(__dirname, '..', '..', 'Collins Scrabble Words (2019) with definitions.txt');
    const raw = fs.readFileSync(dictionaryPath, 'utf8');
    const lines = raw.split('\n');
    lines.forEach((line) => {
      if (!line || line.startsWith('Collins Scrabble Words')) return;
      const parts = line.split('\t');
      if (parts.length < 2) return;
      const word = parts[0].trim().toLowerCase();
      const definition = parts.slice(1).join('\t').trim();
      if (!word || !definition) return;
      nextMap.set(word, definition);
    });
  } catch (error) {
    console.error('Failed loading dictionary definitions for practice breakdown:', error);
  }

  dictionaryDefinitionMap = nextMap;
  return dictionaryDefinitionMap;
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

const getPracticeWordBreakdown = async (req, res) => {
  try {
    const wordsRaw = Array.isArray(req.body?.words) ? req.body.words : [];
    const bonusTilePositions = req.body?.bonusTilePositions && typeof req.body.bonusTilePositions === 'object'
      ? req.body.bonusTilePositions
      : {};

    const normalizedWords = wordsRaw.map((entry) => ({
      word: String(entry?.word || ''),
      score: Number(entry?.score) || 0,
      valid: Boolean(entry?.valid),
      positions: Array.isArray(entry?.positions) ? entry.positions : []
    })).filter((entry) => entry.word);

    if (normalizedWords.length === 0) {
      return res.status(200).json({ words: [], totalWords: 0 });
    }

    const definitionSource = getDictionaryDefinitionMap();
    const uniqueWords = [...new Set(normalizedWords.map((entry) => entry.word.toLowerCase()))];
    const definitionMap = new Map();
    uniqueWords.forEach((word) => {
      definitionMap.set(word, definitionSource.get(word) || null);
    });

    const words = normalizedWords.map((entry) => {
      const key = entry.word.toLowerCase();
      const usedBonusTypes = getUsedBonusTypesForWord(entry.positions, bonusTilePositions);
      const bonusPraise = getBonusPraiseForWord(entry.score, usedBonusTypes, entry.valid);
      const isHighScoringSpecial = entry.valid && entry.score > 50;

      return {
        word: entry.word,
        score: entry.score,
        valid: entry.valid,
        definition: definitionMap.get(key) || null,
        playedByOthersCount: null,
        averageScoreAmongPlayers: null,
        usedBonusTypes,
        bonusPraise,
        isHighScoringSpecial,
        isUniqueTodaySpecial: false,
        isSpecial: isHighScoringSpecial
      };
    });

    return res.status(200).json({
      mode: 'practice',
      words,
      totalWords: words.length
    });
  } catch (error) {
    console.error('Error getting practice word breakdown:', error);
    return res.status(500).json({ error: 'Failed to get practice word breakdown' });
  }
};

module.exports = { getPracticeWordBreakdown };
