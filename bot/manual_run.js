#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BOT_DAILY_RESULT_PREFIX = 'scraple:bot:daily:';
const BOT_DAILY_RESULT_LATEST_KEY = 'scraple:bot:daily:latest';
const BOT_DAILY_RESULT_TTL_SECONDS = 60 * 60 * 24 * 4; // 4 days

function loadEnv() {
  let dotenv = null;
  try {
    dotenv = require('dotenv');
  } catch (_) {
    try {
      dotenv = require('../server/node_modules/dotenv');
    } catch (_) {
      return null;
    }
  }

  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', 'server', '.env'),
    path.resolve(__dirname, '.env')
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath });
    return envPath;
  }

  dotenv.config();
  return '.env (default lookup)';
}

const envPathUsed = loadEnv();

let createClient;
try {
  ({ createClient } = require('redis'));
} catch (_) {
  ({ createClient } = require('../server/node_modules/redis'));
}

const { getEasternDateString } = require('../server/lib/dailyPuzzle');

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

function parseBotJsonFromLine(line) {
  if (!line || !line.startsWith('BOT_RESULT_JSON:')) return null;
  const raw = line.slice('BOT_RESULT_JSON:'.length);
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function redactSecret(value) {
  if (!value) return '(unset)';
  return '***';
}

function printRuntimeEnv(targetDate) {
  console.log(`[force-bot] env file: ${envPathUsed || '(none found)'}`);
  console.log(`[force-bot] BOT_PUZZLE_DATE: ${targetDate}`);
  console.log(`[force-bot] REDIS_URL: ${process.env.REDIS_URL || '(unset)'}`);
  console.log(`[force-bot] REDIS_HOST: ${process.env.REDIS_HOST || '127.0.0.1'}`);
  console.log(`[force-bot] REDIS_PORT: ${process.env.REDIS_PORT || '6379'}`);
  console.log(`[force-bot] REDIS_PW: ${redactSecret(process.env.REDIS_PW)}`);
  console.log(`[force-bot] TIME_LIMIT_MS: ${process.env.TIME_LIMIT_MS || '(unset)'}`);
  console.log(`[force-bot] NODE_LIMIT: ${process.env.NODE_LIMIT || '(unset)'}`);
  console.log(`[force-bot] MEMO_MAX_ENTRIES: ${process.env.MEMO_MAX_ENTRIES || '(unset)'}`);
  console.log(`[force-bot] MEMO_MIN_CELL: ${process.env.MEMO_MIN_CELL || '(unset)'}`);
  console.log(`[force-bot] BOT_PROGRESS_INTERVAL_MS: ${process.env.BOT_PROGRESS_INTERVAL_MS || '(unset)'}`);
  console.log(`[force-bot] TIME_CHECK_EVERY_NODES: ${process.env.TIME_CHECK_EVERY_NODES || '(unset)'}`);
  console.log(`[force-bot] USE_CHEAP_UPPER_BOUND: ${process.env.USE_CHEAP_UPPER_BOUND || '(unset)'}`);
  console.log(`[force-bot] UPPER_BOUND_MIN_CELL: ${process.env.UPPER_BOUND_MIN_CELL || '(unset)'}`);
}

async function main() {
  const targetDate =
    typeof process.env.BOT_PUZZLE_DATE === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(process.env.BOT_PUZZLE_DATE.trim())
      ? process.env.BOT_PUZZLE_DATE.trim()
      : getEasternDateString();
  const resultKey = `${BOT_DAILY_RESULT_PREFIX}${targetDate}`;
  const botScriptPath = path.resolve(__dirname, 'index.js');

  printRuntimeEnv(targetDate);
  console.log(`[force-bot] running bot script: ${botScriptPath}`);

  const redisClient = createClient(getRedisConfig());
  redisClient.on('error', (err) => {
    console.error('[force-bot] redis client error:', err && err.message ? err.message : err);
  });

  await redisClient.connect();

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let parsedResult = null;

  try {
    const child = spawn(process.execPath, [botScriptPath], {
      env: {
        ...process.env,
        BOT_PUZZLE_DATE: targetDate,
        BOT_OUTPUT_JSON: '1',
        BOT_SUPPRESS_LOGS: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer += text;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const parsed = parseBotJsonFromLine(line.trim());
        if (parsed) parsedResult = parsed;
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer += text;
      if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-4000);
    });

    const closeResult = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });

    if (stdoutBuffer) {
      const parsed = parseBotJsonFromLine(stdoutBuffer.trim());
      if (parsed) parsedResult = parsed;
    }

    const payload = parsedResult
      ? {
          ...parsedResult,
          date: targetDate,
          completedAt: new Date().toISOString(),
          exitCode: closeResult.code,
          exitSignal: closeResult.signal || null,
          forcedRerun: true
        }
      : {
          ok: false,
          date: targetDate,
          completedAt: new Date().toISOString(),
          exitCode: closeResult.code,
          exitSignal: closeResult.signal || null,
          forcedRerun: true,
          error: 'Bot worker did not emit BOT_RESULT_JSON payload',
          stderr: stderrBuffer || undefined
        };

    await redisClient.set(resultKey, JSON.stringify(payload), { EX: BOT_DAILY_RESULT_TTL_SECONDS });
    await redisClient.set(BOT_DAILY_RESULT_LATEST_KEY, JSON.stringify(payload), { EX: BOT_DAILY_RESULT_TTL_SECONDS });

    console.log(`[force-bot] overwrite complete: ${resultKey}`);
    console.log(`[force-bot] latest key updated: ${BOT_DAILY_RESULT_LATEST_KEY}`);
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

main().catch((error) => {
  console.error('[force-bot] failed:', error && error.message ? error.message : error);
  process.exit(1);
});
