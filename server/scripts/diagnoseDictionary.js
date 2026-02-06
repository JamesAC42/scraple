#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('redis');
const { getEasternDateString } = require('../lib/dailyPuzzle');

const DICTIONARY_INFO_KEY = 'scraple:dictionary:info';
const DICTIONARY_VERSION_KEY = 'scraple:dictionary:version';
const DAILY_PREFIX = 'scraple:leaderboard:';
const BLITZ_PREFIX = 'scraple:blitz:leaderboard:';

function parseArgs(argv) {
  const args = {
    words: ['aa', 'hello', 'quiz', 'qi'],
    checkStates: false,
    mode: 'daily'
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--words' && argv[i + 1]) {
      args.words = argv[i + 1]
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean);
      i += 1;
    } else if (token === '--check-states') {
      args.checkStates = true;
    } else if (token === '--mode' && argv[i + 1]) {
      const mode = argv[i + 1].trim().toLowerCase();
      if (mode === 'daily' || mode === 'blitz') args.mode = mode;
      i += 1;
    }
  }

  return args;
}

function getRedisConfig() {
  const socket = {
    reconnectStrategy: () => false,
    connectTimeout: 3000
  };

  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL, socket };
  }
  return {
    socket: {
      ...socket,
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379)
    },
    password: process.env.REDIS_PW || undefined
  };
}

function modePrefix(mode) {
  return mode === 'blitz' ? BLITZ_PREFIX : DAILY_PREFIX;
}

async function checkWordLookup(client, word) {
  const lower = word.toLowerCase();
  const upper = word.toUpperCase();
  const [existsLower, existsUpper, defLower, defUpper] = await Promise.all([
    client.hExists(DICTIONARY_INFO_KEY, lower),
    client.hExists(DICTIONARY_INFO_KEY, upper),
    client.hGet(DICTIONARY_INFO_KEY, lower),
    client.hGet(DICTIONARY_INFO_KEY, upper)
  ]);

  return {
    word,
    existsLower: Boolean(existsLower),
    existsUpper: Boolean(existsUpper),
    hasDefinitionLower: Boolean(defLower),
    hasDefinitionUpper: Boolean(defUpper),
    definitionPreview: defLower ? defLower.slice(0, 120) : null
  };
}

function extractWordsFromState(state) {
  if (Array.isArray(state.words)) {
    return state.words
      .map((entry) => String(entry.word || '').trim())
      .filter(Boolean);
  }
  return [];
}

async function checkTodayStates(client, mode) {
  const today = getEasternDateString();
  const statesKey = `${modePrefix(mode)}${today}:states`;
  const exists = await client.exists(statesKey);
  if (!exists) {
    return {
      mode,
      today,
      statesKey,
      exists: false
    };
  }

  const rows = await client.hGetAll(statesKey);
  const allWords = [];
  let parsedStates = 0;
  let invalidJsonStates = 0;

  Object.values(rows).forEach((raw) => {
    try {
      const parsed = JSON.parse(raw);
      parsedStates += 1;
      allWords.push(...extractWordsFromState(parsed));
    } catch (error) {
      invalidJsonStates += 1;
    }
  });

  const uniqueWords = [...new Set(allWords.map((w) => w.toLowerCase()))];
  const misses = [];
  let hits = 0;

  for (const w of uniqueWords) {
    // Dictionary is expected to be lowercase keyed.
    // If this misses heavily, dictionary key or initialization is broken.
    const existsWord = await client.hExists(DICTIONARY_INFO_KEY, w);
    if (existsWord) {
      hits += 1;
    } else {
      misses.push(w);
    }
  }

  return {
    mode,
    today,
    statesKey,
    exists: true,
    totalStates: Object.keys(rows).length,
    parsedStates,
    invalidJsonStates,
    totalWords: allWords.length,
    uniqueWords: uniqueWords.length,
    hits,
    misses: misses.length,
    missSamples: misses.slice(0, 25)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = createClient(getRedisConfig());

  client.on('error', (err) => {
    console.error('Redis client error:', err.message);
  });

  try {
    await client.connect();

    const [infoType, versionType, infoLen, version, infoExists] = await Promise.all([
      client.type(DICTIONARY_INFO_KEY),
      client.type(DICTIONARY_VERSION_KEY),
      client.hLen(DICTIONARY_INFO_KEY),
      client.get(DICTIONARY_VERSION_KEY),
      client.exists(DICTIONARY_INFO_KEY)
    ]);

    const report = {
      dictionary: {
        infoKey: DICTIONARY_INFO_KEY,
        infoType,
        infoExists: Boolean(infoExists),
        infoLength: Number(infoLen),
        versionKey: DICTIONARY_VERSION_KEY,
        versionType,
        version: version || null
      },
      lookups: [],
      stateCheck: null
    };

    for (const word of args.words) {
      report.lookups.push(await checkWordLookup(client, word));
    }

    if (args.checkStates) {
      report.stateCheck = await checkTodayStates(client, args.mode);
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
}

main().catch((error) => {
  console.error('Diagnostic failed:', error);
  process.exit(1);
});
