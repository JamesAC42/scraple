const path = require('path');
const { spawn } = require('child_process');

const BOT_DAILY_RESULT_PREFIX = 'scraple:bot:daily:';
const BOT_DAILY_RESULT_LATEST_KEY = 'scraple:bot:daily:latest';
const BOT_DAILY_LOCK_SUFFIX = ':lock';
const BOT_DAILY_RESULT_TTL_SECONDS = 60 * 60 * 24 * 4; // 4 days
const BOT_DAILY_LOCK_TTL_SECONDS = 60 * 20; // 20 minutes
const BOT_DAILY_LOCK_HEARTBEAT_MS = 30 * 1000; // refresh lock while worker is alive
const BOT_DAILY_WORKER_HARD_TIMEOUT_MS = 2 * 60 * 1000; // parent-side kill guard
const BOT_DAILY_WORKER_KILL_GRACE_MS = 5 * 1000;

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

function tryKill(pidOrGroup, signal) {
  try {
    process.kill(pidOrGroup, signal);
    return true;
  } catch (_) {
    return false;
  }
}

function killWorkerProcessTree(child, signal = 'SIGTERM') {
  if (!child || !child.pid) return;
  if (process.platform !== 'win32') {
    // Child is started detached on Unix-like systems, so negative PID targets the process group.
    tryKill(-child.pid, signal);
  }
  try {
    child.kill(signal);
  } catch (_) {
    // no-op
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
      // Do not auto-retry from read traffic once we have a completed payload for that date.
      if (existingPayload && existingPayload.date === dateString && existingPayload.completedAt) return false;
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
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let parsedResult = null;
  let finalized = false;
  let killedByWatchdog = false;
  let lockHeartbeatInFlight = false;

  const lockHeartbeat = setInterval(async () => {
    if (finalized || lockHeartbeatInFlight) return;
    lockHeartbeatInFlight = true;
    try {
      await redisClient.expire(lockKey, BOT_DAILY_LOCK_TTL_SECONDS);
    } catch (_) {
      // Best effort. If refresh fails transiently, next heartbeat can still recover.
    } finally {
      lockHeartbeatInFlight = false;
    }
  }, BOT_DAILY_LOCK_HEARTBEAT_MS);

  const hardTimeout = setTimeout(() => {
    if (finalized) return;
    killedByWatchdog = true;
    killWorkerProcessTree(child, 'SIGTERM');
    setTimeout(() => {
      if (finalized) return;
      killWorkerProcessTree(child, 'SIGKILL');
    }, BOT_DAILY_WORKER_KILL_GRACE_MS);
  }, BOT_DAILY_WORKER_HARD_TIMEOUT_MS);

  const clearWorkerTimers = () => {
    clearInterval(lockHeartbeat);
    clearTimeout(hardTimeout);
  };

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

  child.on('close', (code, signal) => {
    clearWorkerTimers();
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
            exitCode: code,
            exitSignal: signal || null,
            killedByWatchdog
          };
        } else {
          payload = {
            ok: false,
            date: dateString,
            completedAt: new Date().toISOString(),
            exitCode: code,
            exitSignal: signal || null,
            killedByWatchdog,
            hardTimeoutMs: BOT_DAILY_WORKER_HARD_TIMEOUT_MS,
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
    clearWorkerTimers();
    (async () => {
      if (finalized) return;
      finalized = true;

      try {
        const payload = {
          ok: false,
          date: dateString,
          completedAt: new Date().toISOString(),
          killedByWatchdog,
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
