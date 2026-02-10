#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('redis');
const { getEasternDateString } = require('../lib/dailyPuzzle');

const DAILY_LEADERBOARD_PREFIX = 'scraple:leaderboard:';
const BLITZ_LEADERBOARD_PREFIX = 'scraple:blitz:leaderboard:';
const DAILY_PUZZLE_PREFIX = 'scraple:daily:';
const BLITZ_PUZZLE_PREFIX = 'scraple:blitz:daily:';
const DAILY_COMMENTS_PREFIX = 'scraple:comments:daily:';
const BLITZ_COMMENTS_PREFIX = 'scraple:comments:blitz:';
const DAILY_STREAKS_KEY = 'scraple:streaks:daily';
const BLITZ_STREAKS_KEY = 'scraple:streaks:blitz';
const PLAYER_NICKNAMES_KEY = 'scraple:player:nicknames';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  const withEquals = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (withEquals) {
    return withEquals.split('=')[1];
  }
  return null;
}

function hasFlag(flag) {
  return process.argv.includes(flag) || process.argv.some((arg) => arg.startsWith(`${flag}=`));
}

function getScanPrefixes(mode) {
  if (mode === 'daily') {
    return [DAILY_LEADERBOARD_PREFIX, DAILY_PUZZLE_PREFIX, DAILY_COMMENTS_PREFIX];
  }
  if (mode === 'blitz') {
    return [BLITZ_LEADERBOARD_PREFIX, BLITZ_PUZZLE_PREFIX, BLITZ_COMMENTS_PREFIX];
  }
  return [
    DAILY_LEADERBOARD_PREFIX,
    BLITZ_LEADERBOARD_PREFIX,
    DAILY_PUZZLE_PREFIX,
    BLITZ_PUZZLE_PREFIX,
    DAILY_COMMENTS_PREFIX,
    BLITZ_COMMENTS_PREFIX
  ];
}

function getGlobalKeys(mode) {
  if (mode === 'daily') return [DAILY_STREAKS_KEY, PLAYER_NICKNAMES_KEY];
  if (mode === 'blitz') return [BLITZ_STREAKS_KEY, PLAYER_NICKNAMES_KEY];
  return [DAILY_STREAKS_KEY, BLITZ_STREAKS_KEY, PLAYER_NICKNAMES_KEY];
}

function getDateScopedKeys(mode, date) {
  const keys = [];

  if (mode === 'daily' || mode === 'both') {
    const leaderboardKey = `${DAILY_LEADERBOARD_PREFIX}${date}`;
    const commentsKey = `${DAILY_COMMENTS_PREFIX}${date}`;
    keys.push(
      leaderboardKey,
      `${leaderboardKey}:states`,
      `${leaderboardKey}:word-avg-score`,
      `${leaderboardKey}:word-avg-score:players`,
      `${DAILY_PUZZLE_PREFIX}${date}`,
      commentsKey,
      `${commentsKey}:players`
    );
  }

  if (mode === 'blitz' || mode === 'both') {
    const leaderboardKey = `${BLITZ_LEADERBOARD_PREFIX}${date}`;
    const commentsKey = `${BLITZ_COMMENTS_PREFIX}${date}`;
    keys.push(
      leaderboardKey,
      `${leaderboardKey}:states`,
      `${leaderboardKey}:word-avg-score`,
      `${leaderboardKey}:word-avg-score:players`,
      `${BLITZ_PUZZLE_PREFIX}${date}`,
      commentsKey,
      `${commentsKey}:players`
    );
  }

  return keys;
}

async function deleteKeys(redisClient, keys) {
  if (!keys.length) return 0;
  const chunkSize = 500;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    deleted += await redisClient.del(chunk);
  }
  return deleted;
}

async function deleteByScan(redisClient, prefix) {
  const keys = [];
  for await (const key of redisClient.scanIterator({ MATCH: `${prefix}*`, COUNT: 1000 })) {
    keys.push(key);
  }
  return deleteKeys(redisClient, keys);
}

async function run() {
  const modeValue = (getArgValue('--mode') || 'both').toLowerCase();
  const mode = ['daily', 'blitz', 'both'].includes(modeValue) ? modeValue : 'both';
  const all = hasFlag('--all');
  const dateArg = getArgValue('--date');
  const date = dateArg || getEasternDateString();

  const clientOptions = {
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) return false;
        return Math.min(retries * 100, 3000);
      }
    }
  };

  if (process.env.REDIS_URL) {
    clientOptions.url = process.env.REDIS_URL;
  }
  if (process.env.REDIS_PW) {
    clientOptions.password = process.env.REDIS_PW;
  }

  const redisClient = createClient(clientOptions);

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  await redisClient.connect();

  let totalDeleted = 0;
  const prefixes = getScanPrefixes(mode);
  const globalKeys = getGlobalKeys(mode);

  if (all) {
    for (const prefix of prefixes) {
      totalDeleted += await deleteByScan(redisClient, prefix);
    }
    totalDeleted += await deleteKeys(redisClient, globalKeys);
  } else {
    const keys = [
      ...getDateScopedKeys(mode, date),
      ...globalKeys
    ];
    totalDeleted = await deleteKeys(redisClient, keys);
  }

  await redisClient.quit();

  const scope = all ? 'all dates' : `date ${date}`;
  console.log(`Deleted ${totalDeleted} Redis key(s) for ${mode} game data, ${scope}. Dictionary keys were preserved.`);
}

run().catch((err) => {
  console.error('Failed to reset leaderboard:', err);
  process.exit(1);
});
