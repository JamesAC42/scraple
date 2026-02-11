const path = require('path');
const { spawn } = require('child_process');

const BOT_DAILY_RESULT_PREFIX = 'scraple:bot:daily:';
const BOT_DAILY_RESULT_LATEST_KEY = 'scraple:bot:daily:latest';
const BOT_DAILY_LOCK_SUFFIX = ':lock';
const BOT_DAILY_RESULT_TTL_SECONDS = 60 * 60 * 24 * 4; // 4 days
const BOT_DAILY_LOCK_TTL_SECONDS = 60 * 20; // 20 minutes

function buildKeys(dateString) {
  const resultKey = `${BOT_DAILY_RESULT_PREFIX}${dateString}`;
  const lockKey = `${resultKey}${BOT_DAILY_LOCK_SUFFIX}`;
  return { resultKey, lockKey };
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

async function triggerDailyBotSolveIfMissing(redisClient, dateString) {
  if (!redisClient || !redisClient.isOpen) return false;
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;

  const { resultKey, lockKey } = buildKeys(dateString);
  const existingRaw = await redisClient.get(resultKey);
  if (existingRaw) {
    try {
      const existingPayload = JSON.parse(existingRaw);
      if (existingPayload && existingPayload.ok === true) return false;
    } catch (_) {
      return false;
    }
  }

  const lockValue = `${process.pid}:${Date.now()}`;
  const locked = await redisClient.set(lockKey, lockValue, {
    NX: true,
    EX: BOT_DAILY_LOCK_TTL_SECONDS
  });
  if (!locked) return false;

  const botScriptPath = path.resolve(__dirname, '..', '..', 'bot', 'index.js');
  const child = spawn(process.execPath, [botScriptPath], {
    env: {
      ...process.env,
      BOT_PUZZLE_DATE: dateString,
      BOT_OUTPUT_JSON: '1',
      BOT_SUPPRESS_LOGS: process.env.BOT_WORKER_SUPPRESS_LOGS || '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let parsedResult = null;
  let finalized = false;

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const parsed = parseBotJsonFromLine(line.trim());
      if (parsed) parsedResult = parsed;
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    if (stderrBuffer.length > 4000) {
      stderrBuffer = stderrBuffer.slice(-4000);
    }
  });

  child.on('close', (code) => {
    if (stdoutBuffer) {
      const parsed = parseBotJsonFromLine(stdoutBuffer.trim());
      if (parsed) parsedResult = parsed;
    }

    (async () => {
      if (finalized) return;
      finalized = true;

      try {
        let payload = null;
        if (parsedResult) {
          payload = {
            ...parsedResult,
            date: dateString,
            completedAt: new Date().toISOString(),
            exitCode: code
          };
        } else {
          payload = {
            ok: false,
            date: dateString,
            completedAt: new Date().toISOString(),
            exitCode: code,
            error: 'Bot worker did not emit BOT_RESULT_JSON payload',
            stderr: stderrBuffer || undefined
          };
        }

        await redisClient.set(resultKey, JSON.stringify(payload), {
          EX: BOT_DAILY_RESULT_TTL_SECONDS
        });
        await redisClient.set(BOT_DAILY_RESULT_LATEST_KEY, JSON.stringify(payload), {
          EX: BOT_DAILY_RESULT_TTL_SECONDS
        });
      } catch (err) {
        console.error('Failed persisting bot daily result:', err);
      } finally {
        try {
          await redisClient.del(lockKey);
        } catch (err) {
          console.error('Failed releasing bot daily lock:', err);
        }
      }
    })().catch((err) => {
      console.error('Unexpected bot worker close handler error:', err);
    });
  });

  child.on('error', (error) => {
    (async () => {
      if (finalized) return;
      finalized = true;

      try {
        const payload = {
          ok: false,
          date: dateString,
          completedAt: new Date().toISOString(),
          error: error && error.message ? error.message : String(error)
        };
        await redisClient.set(resultKey, JSON.stringify(payload), {
          EX: BOT_DAILY_RESULT_TTL_SECONDS
        });
      } catch (err) {
        console.error('Failed persisting bot worker spawn error:', err);
      } finally {
        try {
          await redisClient.del(lockKey);
        } catch (err) {
          console.error('Failed releasing bot daily lock after spawn error:', err);
        }
      }
    })().catch((err) => {
      console.error('Unexpected bot worker error handler exception:', err);
    });
  });

  return true;
}

module.exports = {
  BOT_DAILY_RESULT_PREFIX,
  BOT_DAILY_RESULT_LATEST_KEY,
  triggerDailyBotSolveIfMissing
};
