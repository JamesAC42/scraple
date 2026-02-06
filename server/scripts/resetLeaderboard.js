#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('redis');
const { getEasternDateString } = require('../lib/dailyPuzzle');

const DAILY_PREFIX = 'scraple:leaderboard:';
const BLITZ_PREFIX = 'scraple:blitz:leaderboard:';

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

function getPrefixes(mode) {
  if (mode === 'daily') return [DAILY_PREFIX];
  if (mode === 'blitz') return [BLITZ_PREFIX];
  return [DAILY_PREFIX, BLITZ_PREFIX];
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
  const prefixes = getPrefixes(mode);

  if (all) {
    for (const prefix of prefixes) {
      totalDeleted += await deleteByScan(redisClient, prefix);
    }
  } else {
    const keys = [];
    for (const prefix of prefixes) {
      const baseKey = `${prefix}${date}`;
      keys.push(
        baseKey,
        `${baseKey}:states`,
        `${baseKey}:word-avg-score`,
        `${baseKey}:word-avg-score:players`
      );
    }
    totalDeleted = await deleteKeys(redisClient, keys);
  }

  await redisClient.quit();

  const scope = all ? 'all dates' : `date ${date}`;
  console.log(`Deleted ${totalDeleted} Redis key(s) for ${mode} leaderboard(s), ${scope}.`);
}

run().catch((err) => {
  console.error('Failed to reset leaderboard:', err);
  process.exit(1);
});
