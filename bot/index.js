#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function loadEnv() {
  let dotenv = null;
  try {
    dotenv = require('dotenv');
  } catch (_) {
    try {
      dotenv = require('../server/node_modules/dotenv');
    } catch (_) {
      return;
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
    return;
  }

  dotenv.config();
}

loadEnv();

let createClient;
try {
  ({ createClient } = require('redis'));
} catch (_) {
  ({ createClient } = require('../server/node_modules/redis'));
}

const { getEasternDateString } = require('../server/lib/dailyPuzzle');

const BOARD_SIZE = 5;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const MIN_WORD_LEN = 2;

const DICTIONARY_INFO_KEY = 'scraple:dictionary:info';
const DAILY_PUZZLE_PREFIX = 'scraple:daily:';

const UNASSIGNED = 255;
const EMPTY = 26;

const LETTER_POINTS = new Uint8Array([
  1, // A
  3, // B
  3, // C
  2, // D
  1, // E
  4, // F
  2, // G
  4, // H
  1, // I
  8, // J
  5, // K
  1, // L
  3, // M
  1, // N
  1, // O
  3, // P
  10, // Q
  1, // R
  1, // S
  1, // T
  1, // U
  4, // V
  4, // W
  8, // X
  4, // Y
  10 // Z
]);

const BONUS_TYPES = {
  DOUBLE_LETTER: 'DOUBLE_LETTER',
  TRIPLE_LETTER: 'TRIPLE_LETTER',
  DOUBLE_WORD: 'DOUBLE_WORD',
  TRIPLE_WORD: 'TRIPLE_WORD'
};

const LETTER_RE = /^[A-Z]+$/;
const ALPHA_CODE = 'A'.charCodeAt(0);

function toLetterIndex(letter) {
  const code = letter.charCodeAt(0) - ALPHA_CODE;
  return code >= 0 && code < 26 ? code : -1;
}

function isLetter(v) {
  return v >= 0 && v < 26;
}

function cellRow(i) {
  return (i / BOARD_SIZE) | 0;
}

function cellCol(i) {
  return i % BOARD_SIZE;
}

function cellIndex(row, col) {
  return row * BOARD_SIZE + col;
}

function indexToPos(i) {
  return [cellRow(i), cellCol(i)];
}

function decodeLetter(v) {
  return String.fromCharCode(ALPHA_CODE + v);
}

function buildBonusMaps(bonusCoords) {
  const letterMult = new Uint8Array(CELL_COUNT);
  const wordMult = new Uint8Array(CELL_COUNT);
  letterMult.fill(1);
  wordMult.fill(1);

  const setBonus = (type, setter) => {
    if (!bonusCoords || !Array.isArray(bonusCoords[type]) || bonusCoords[type].length < 2) return;
    const row = Number(bonusCoords[type][0]);
    const col = Number(bonusCoords[type][1]);
    if (
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      row >= 0 &&
      row < BOARD_SIZE &&
      col >= 0 &&
      col < BOARD_SIZE
    ) {
      setter(cellIndex(row, col));
    }
  };

  setBonus(BONUS_TYPES.DOUBLE_LETTER, (i) => {
    letterMult[i] = 2;
  });
  setBonus(BONUS_TYPES.TRIPLE_LETTER, (i) => {
    letterMult[i] = 3;
  });
  setBonus(BONUS_TYPES.DOUBLE_WORD, (i) => {
    wordMult[i] = 2;
  });
  setBonus(BONUS_TYPES.TRIPLE_WORD, (i) => {
    wordMult[i] = 3;
  });

  return { letterMult, wordMult };
}

function buildRackCounts(letters) {
  const counts = new Uint8Array(26);
  for (const raw of letters) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const idx = toLetterIndex(raw);
    if (idx >= 0) counts[idx] += 1;
  }
  return counts;
}

function normalizePuzzleLetters(puzzle) {
  if (!puzzle || !Array.isArray(puzzle.letters)) return [];
  const out = [];
  for (const entry of puzzle.letters) {
    const letter = typeof entry === 'string' ? entry : entry && entry.letter;
    if (typeof letter !== 'string' || letter.length === 0) continue;
    const upper = letter[0].toUpperCase();
    if (toLetterIndex(upper) >= 0) out.push(upper);
  }
  return out;
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

class CompactTrie {
  constructor(initialNodeCap = 1024, initialEdgeCap = 4096) {
    this.nodeCap = initialNodeCap;
    this.edgeCap = initialEdgeCap;
    this.nodeCount = 1; // root at 0
    this.edgeCount = 0;

    this.nodeHead = new Uint32Array(this.nodeCap);
    this.nodeHead.fill(0xffffffff);
    this.nodeIsWord = new Uint8Array(this.nodeCap);

    this.edgeChar = new Uint8Array(this.edgeCap);
    this.edgeTo = new Uint32Array(this.edgeCap);
    this.edgeNext = new Uint32Array(this.edgeCap);
    this.edgeNext.fill(0xffffffff);
  }

  ensureNodeCapacity() {
    if (this.nodeCount < this.nodeCap) return;
    const nextCap = this.nodeCap * 2;

    const nextHead = new Uint32Array(nextCap);
    nextHead.fill(0xffffffff);
    nextHead.set(this.nodeHead);
    this.nodeHead = nextHead;

    const nextIsWord = new Uint8Array(nextCap);
    nextIsWord.set(this.nodeIsWord);
    this.nodeIsWord = nextIsWord;

    this.nodeCap = nextCap;
  }

  ensureEdgeCapacity() {
    if (this.edgeCount < this.edgeCap) return;
    const nextCap = this.edgeCap * 2;

    const nextChar = new Uint8Array(nextCap);
    nextChar.set(this.edgeChar);
    this.edgeChar = nextChar;

    const nextTo = new Uint32Array(nextCap);
    nextTo.set(this.edgeTo);
    this.edgeTo = nextTo;

    const nextNext = new Uint32Array(nextCap);
    nextNext.fill(0xffffffff);
    nextNext.set(this.edgeNext);
    this.edgeNext = nextNext;

    this.edgeCap = nextCap;
  }

  createNode() {
    this.ensureNodeCapacity();
    const idx = this.nodeCount;
    this.nodeCount += 1;
    this.nodeHead[idx] = 0xffffffff;
    this.nodeIsWord[idx] = 0;
    return idx;
  }

  findEdge(node, letterIdx) {
    let e = this.nodeHead[node];
    while (e !== 0xffffffff) {
      if (this.edgeChar[e] === letterIdx) return e;
      e = this.edgeNext[e];
    }
    return 0xffffffff;
  }

  getOrAddChild(node, letterIdx) {
    const existing = this.findEdge(node, letterIdx);
    if (existing !== 0xffffffff) return this.edgeTo[existing];

    const child = this.createNode();
    this.ensureEdgeCapacity();
    const edge = this.edgeCount;
    this.edgeCount += 1;

    this.edgeChar[edge] = letterIdx;
    this.edgeTo[edge] = child;
    this.edgeNext[edge] = this.nodeHead[node];
    this.nodeHead[node] = edge;

    return child;
  }

  insertWord(wordUpper) {
    let node = 0;
    for (let i = 0; i < wordUpper.length; i += 1) {
      const li = toLetterIndex(wordUpper[i]);
      if (li < 0) return;
      node = this.getOrAddChild(node, li);
    }
    this.nodeIsWord[node] = 1;
  }

  hasPrefixFromBuffer(buffer, len) {
    let node = 0;
    for (let i = 0; i < len; i += 1) {
      const e = this.findEdge(node, buffer[i]);
      if (e === 0xffffffff) return false;
      node = this.edgeTo[e];
    }
    return true;
  }
}

async function loadDictionary(redisClient) {
  const wordSet = new Set();
  const trie = new CompactTrie();
  let loadedWords = 0;
  let cursor = '0';

  do {
    const scan = await redisClient.sendCommand([
      'HSCAN',
      DICTIONARY_INFO_KEY,
      cursor,
      'COUNT',
      '4000'
    ]);
    cursor = scan[0];
    const entries = scan[1] || [];
    for (let i = 0; i < entries.length; i += 2) {
      const rawWord = String(entries[i] || '').toUpperCase();
      if (!LETTER_RE.test(rawWord)) continue;
      wordSet.add(rawWord);
      trie.insertWord(rawWord);
      loadedWords += 1;
    }
  } while (cursor !== '0');

  return { wordSet, trie, loadedWords };
}

function formatBoard(board) {
  const lines = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const cells = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const v = board[cellIndex(row, col)];
      if (v === EMPTY || v === UNASSIGNED) cells.push('.');
      else cells.push(decodeLetter(v));
    }
    lines.push(cells.join(' '));
  }
  return lines.join('\n');
}

function boardToPlacedTiles(board) {
  const out = {};
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const v = board[i];
    if (!isLetter(v)) continue;
    const [row, col] = indexToPos(i);
    const letter = decodeLetter(v);
    out[`${row}-${col}`] = { letter, points: LETTER_POINTS[v] };
  }
  return out;
}

function makeSolver({ letters, bonusCoords, wordSet, trie, options = {} }) {
  const useUpperBound = options.useUpperBound !== false;

  const board = new Uint8Array(CELL_COUNT);
  board.fill(UNASSIGNED);

  const counts = buildRackCounts(letters);
  const totalRackLetters = counts.reduce((sum, n) => sum + n, 0);

  const { letterMult, wordMult } = buildBonusMaps(bonusCoords);

  const prefixBufferAcross = new Uint8Array(BOARD_SIZE);
  const prefixBufferDown = new Uint8Array(BOARD_SIZE);
  const wordBuffer = new Uint8Array(BOARD_SIZE);

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestBoard = null;
  let bestWords = [];

  let explored = 0;
  let prunedPrefix = 0;
  let prunedWord = 0;
  let prunedUpper = 0;
  let progress = null;
  let upperChecks = 0;
  let minAcceptedUpperBound = Number.POSITIVE_INFINITY;
  let maxPrunedUpperBound = Number.NEGATIVE_INFINITY;
  let placedLetterBase = 0;

  const rowWordBound = new Uint8Array(BOARD_SIZE);
  const colWordBound = new Uint8Array(BOARD_SIZE);
  const cellCoeff = new Uint16Array(CELL_COUNT);
  const coeffBuckets = new Uint16Array(64);
  const pointBuckets = new Uint16Array(11);
  const POINT_ORDER = [10, 8, 5, 4, 3, 2, 1];

  function estimateUpperBound() {
    // For each row/col, compute the best word-multiplier product available in any
    // contiguous non-EMPTY run of length >= 2.
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      let best = 0;
      let col = 0;
      while (col < BOARD_SIZE) {
        let idx = cellIndex(row, col);
        if (board[idx] === EMPTY) {
          col += 1;
          continue;
        }
        let runLen = 0;
        let runProduct = 1;
        while (col < BOARD_SIZE) {
          idx = cellIndex(row, col);
          if (board[idx] === EMPTY) break;
          runLen += 1;
          runProduct *= wordMult[idx];
          col += 1;
        }
        if (runLen >= MIN_WORD_LEN && runProduct > best) best = runProduct;
      }
      rowWordBound[row] = best;
    }

    for (let col = 0; col < BOARD_SIZE; col += 1) {
      let best = 0;
      let row = 0;
      while (row < BOARD_SIZE) {
        let idx = cellIndex(row, col);
        if (board[idx] === EMPTY) {
          row += 1;
          continue;
        }
        let runLen = 0;
        let runProduct = 1;
        while (row < BOARD_SIZE) {
          idx = cellIndex(row, col);
          if (board[idx] === EMPTY) break;
          runLen += 1;
          runProduct *= wordMult[idx];
          row += 1;
        }
        if (runLen >= MIN_WORD_LEN && runProduct > best) best = runProduct;
      }
      colWordBound[col] = best;
    }

    coeffBuckets.fill(0);
    pointBuckets.fill(0);

    let fixedContributionUpper = 0;
    let maxCoeff = 0;

    for (let i = 0; i < CELL_COUNT; i += 1) {
      if (board[i] === EMPTY) continue;
      const row = cellRow(i);
      const col = cellCol(i);
      const coeff = letterMult[i] * (rowWordBound[row] + colWordBound[col]);
      cellCoeff[i] = coeff;
      if (coeff > maxCoeff) maxCoeff = coeff;

      const v = board[i];
      if (isLetter(v)) {
        fixedContributionUpper += LETTER_POINTS[v] * coeff;
      } else if (v === UNASSIGNED) {
        coeffBuckets[coeff] += 1;
      }
    }

    for (let li = 0; li < 26; li += 1) {
      const cnt = counts[li];
      if (cnt > 0) pointBuckets[LETTER_POINTS[li]] += cnt;
    }

    let optimisticRemaining = 0;
    let coeffCursor = maxCoeff;

    for (const pts of POINT_ORDER) {
      let availableLetters = pointBuckets[pts];
      while (availableLetters > 0) {
        while (coeffCursor > 0 && coeffBuckets[coeffCursor] === 0) {
          coeffCursor -= 1;
        }
        if (coeffCursor <= 0) {
          availableLetters = 0;
          break;
        }
        optimisticRemaining += pts * coeffCursor;
        coeffBuckets[coeffCursor] -= 1;
        availableLetters -= 1;
      }
    }

    return fixedContributionUpper + optimisticRemaining;
  }

  function getAcrossPrefixEndingAt(i, outBuf) {
    const row = cellRow(i);
    let start = i;
    while (cellCol(start) > 0 && isLetter(board[start - 1]) && cellRow(start - 1) === row) {
      start -= 1;
    }

    let len = 0;
    for (let p = start; p <= i; p += 1) {
      const v = board[p];
      if (!isLetter(v)) return 0;
      outBuf[len] = v;
      len += 1;
    }
    return len;
  }

  function getDownPrefixEndingAt(i, outBuf) {
    let start = i;
    while (cellRow(start) > 0 && isLetter(board[start - BOARD_SIZE])) {
      start -= BOARD_SIZE;
    }

    let len = 0;
    for (let p = start; p <= i; p += BOARD_SIZE) {
      const v = board[p];
      if (!isLetter(v)) return 0;
      outBuf[len] = v;
      len += 1;
    }
    return len;
  }

  function readAcrossWordEndingAt(endIndex, outBuf) {
    const row = cellRow(endIndex);
    let start = endIndex;
    while (cellCol(start) > 0 && isLetter(board[start - 1]) && cellRow(start - 1) === row) {
      start -= 1;
    }
    let len = 0;
    for (let p = start; p <= endIndex; p += 1) {
      const v = board[p];
      if (!isLetter(v)) return 0;
      outBuf[len] = v;
      len += 1;
    }
    return len;
  }

  function readDownWordEndingAt(endIndex, outBuf) {
    let start = endIndex;
    while (cellRow(start) > 0 && isLetter(board[start - BOARD_SIZE])) {
      start -= BOARD_SIZE;
    }
    let len = 0;
    for (let p = start; p <= endIndex; p += BOARD_SIZE) {
      const v = board[p];
      if (!isLetter(v)) return 0;
      outBuf[len] = v;
      len += 1;
    }
    return len;
  }

  function bufferToWord(buf, len) {
    let s = '';
    for (let i = 0; i < len; i += 1) s += decodeLetter(buf[i]);
    return s;
  }

  function validateLocalAfterEmpty(i) {
    const col = cellCol(i);
    const row = cellRow(i);

    if (col > 0 && isLetter(board[i - 1])) {
      const len = readAcrossWordEndingAt(i - 1, wordBuffer);
      if (len >= MIN_WORD_LEN) {
        const w = bufferToWord(wordBuffer, len);
        if (!wordSet.has(w)) return false;
      }
    }

    if (row > 0 && isLetter(board[i - BOARD_SIZE])) {
      const len = readDownWordEndingAt(i - BOARD_SIZE, wordBuffer);
      if (len >= MIN_WORD_LEN) {
        const w = bufferToWord(wordBuffer, len);
        if (!wordSet.has(w)) return false;
      }
    }

    return true;
  }

  function validateLocalAfterLetter(i) {
    const row = cellRow(i);
    const col = cellCol(i);

    const acrossLen = getAcrossPrefixEndingAt(i, prefixBufferAcross);
    if (acrossLen > 0) {
      const acrossClosed = col === BOARD_SIZE - 1 || board[i + 1] === EMPTY;
      if (acrossClosed) {
        if (acrossLen >= MIN_WORD_LEN) {
          const w = bufferToWord(prefixBufferAcross, acrossLen);
          if (!wordSet.has(w)) return false;
        }
      } else if (!trie.hasPrefixFromBuffer(prefixBufferAcross, acrossLen)) {
        return false;
      }
    }

    const downLen = getDownPrefixEndingAt(i, prefixBufferDown);
    if (downLen > 0) {
      const below = i + BOARD_SIZE;
      const downClosed = row === BOARD_SIZE - 1 || board[below] === EMPTY;
      if (downClosed) {
        if (downLen >= MIN_WORD_LEN) {
          const w = bufferToWord(prefixBufferDown, downLen);
          if (!wordSet.has(w)) return false;
        }
      } else if (!trie.hasPrefixFromBuffer(prefixBufferDown, downLen)) {
        return false;
      }
    }

    return true;
  }

  function evaluateFinalBoard() {
    let total = 0;
    const words = [];

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      let col = 0;
      while (col < BOARD_SIZE) {
        const start = cellIndex(row, col);
        if (!isLetter(board[start])) {
          col += 1;
          continue;
        }

        let endCol = col;
        while (endCol + 1 < BOARD_SIZE && isLetter(board[cellIndex(row, endCol + 1)])) {
          endCol += 1;
        }

        const len = endCol - col + 1;
        if (len >= MIN_WORD_LEN) {
          let raw = 0;
          let mult = 1;
          let word = '';
          for (let c = col; c <= endCol; c += 1) {
            const idx = cellIndex(row, c);
            const li = board[idx];
            word += decodeLetter(li);
            raw += LETTER_POINTS[li] * letterMult[idx];
            mult *= wordMult[idx];
          }
          if (!wordSet.has(word)) return null;
          const score = raw * mult;
          total += score;
          words.push({ word, score });
        }
        col = endCol + 1;
      }
    }

    for (let col = 0; col < BOARD_SIZE; col += 1) {
      let row = 0;
      while (row < BOARD_SIZE) {
        const start = cellIndex(row, col);
        if (!isLetter(board[start])) {
          row += 1;
          continue;
        }

        let endRow = row;
        while (endRow + 1 < BOARD_SIZE && isLetter(board[cellIndex(endRow + 1, col)])) {
          endRow += 1;
        }

        const len = endRow - row + 1;
        if (len >= MIN_WORD_LEN) {
          let raw = 0;
          let mult = 1;
          let word = '';
          for (let r = row; r <= endRow; r += 1) {
            const idx = cellIndex(r, col);
            const li = board[idx];
            word += decodeLetter(li);
            raw += LETTER_POINTS[li] * letterMult[idx];
            mult *= wordMult[idx];
          }
          if (!wordSet.has(word)) return null;
          const score = raw * mult;
          total += score;
          words.push({ word, score });
        }
        row = endRow + 1;
      }
    }

    return { total, words };
  }

  function dfs(cell) {
    if (progress) {
      const now = Date.now();
      if (now - progress.lastLogAt >= progress.intervalMs) {
        progress.lastLogAt = now;
        console.log(
          `[search] explored=${explored} best=${Number.isFinite(bestScore) ? bestScore : 'N/A'} ` +
            `prunePrefix=${prunedPrefix} pruneWord=${prunedWord} pruneUpper=${prunedUpper}`
        );
      }
    }

    explored += 1;

    if (progress && progress.debugBound && useUpperBound && (explored & 0xfffff) === 0) {
      const b = estimateUpperBound();
      console.log(`[dbg] cell=${cell} best=${bestScore} bound=${b} placedBase=${placedLetterBase}`);
    }

    if (cell === CELL_COUNT) {
      const evaluated = evaluateFinalBoard();
      if (!evaluated) {
        prunedWord += 1;
        return;
      }
      if (evaluated.total > bestScore) {
        bestScore = evaluated.total;
        bestBoard = new Uint8Array(board);
        bestWords = evaluated.words;
      }
      return;
    }

    if (board[cell] !== UNASSIGNED) {
      dfs(cell + 1);
      return;
    }

    for (let letter = 0; letter < 26; letter += 1) {
      if (counts[letter] === 0) continue;
      board[cell] = letter;
      counts[letter] -= 1;
      placedLetterBase += LETTER_POINTS[letter] * letterMult[cell];

      if (validateLocalAfterLetter(cell)) {
        if (!useUpperBound) {
          dfs(cell + 1);
        } else {
          const bound = estimateUpperBound();
          upperChecks += 1;
          if (bound > bestScore) {
            if (bound < minAcceptedUpperBound) minAcceptedUpperBound = bound;
            dfs(cell + 1);
          } else {
            prunedUpper += 1;
            if (bound > maxPrunedUpperBound) maxPrunedUpperBound = bound;
          }
        }
      } else {
        prunedPrefix += 1;
      }

      counts[letter] += 1;
      placedLetterBase -= LETTER_POINTS[letter] * letterMult[cell];
      board[cell] = UNASSIGNED;
    }

    board[cell] = EMPTY;
    if (validateLocalAfterEmpty(cell)) {
      if (!useUpperBound) {
        dfs(cell + 1);
      } else {
        const bound = estimateUpperBound();
        upperChecks += 1;
        if (bound > bestScore) {
          if (bound < minAcceptedUpperBound) minAcceptedUpperBound = bound;
          dfs(cell + 1);
        } else {
          prunedUpper += 1;
          if (bound > maxPrunedUpperBound) maxPrunedUpperBound = bound;
        }
      }
    } else {
      prunedWord += 1;
    }
    board[cell] = UNASSIGNED;
  }

  function solve() {
    const startedAt = Date.now();
    progress = { lastLogAt: startedAt, intervalMs: 3000, debugBound: options.debugBound === true };
    dfs(0);
    progress = null;

    return {
      bestScore,
      bestBoard,
      bestWords,
      explored,
      prunedPrefix,
      prunedWord,
      prunedUpper,
      upperChecks,
      minAcceptedUpperBound: Number.isFinite(minAcceptedUpperBound) ? minAcceptedUpperBound : null,
      maxPrunedUpperBound: Number.isFinite(maxPrunedUpperBound) ? maxPrunedUpperBound : null,
      totalRackLetters,
      durationMs: Date.now() - startedAt
    };
  }

  return { solve };
}

async function loadTodayPuzzle(redisClient) {
  const today = getEasternDateString();
  const redisKey = `${DAILY_PUZZLE_PREFIX}${today}`;
  const raw = await redisClient.get(redisKey);
  if (!raw) {
    throw new Error(`No puzzle found in Redis at key "${redisKey}"`);
  }
  const parsed = JSON.parse(raw);
  return { today, redisKey, puzzle: parsed };
}

async function main() {
  const debugBound = process.env.BOT_DEBUG_BOUND === '1';
  const verifyBound = process.env.BOT_VERIFY_BOUND === '1';
  const assertPrune = process.env.BOT_ASSERT_PRUNE === '1';

  const redisClient = createClient(getRedisConfig());
  redisClient.on('error', (err) => {
    console.error('Redis client error:', err && err.message ? err.message : err);
  });

  try {
    await redisClient.connect();

    console.log('[bot] loading today\'s puzzle from redis...');
    const { today, redisKey, puzzle } = await loadTodayPuzzle(redisClient);
    const letters = normalizePuzzleLetters(puzzle);
    console.log(
      `[bot] puzzle date=${today} key=${redisKey} rackLetters=${letters.length} bonuses=${JSON.stringify(
        puzzle.bonusTilePositions || {}
      )}`
    );

    console.log('[bot] loading dictionary from redis and building word set + trie...');
    const { wordSet, trie, loadedWords } = await loadDictionary(redisClient);
    console.log(`[bot] dictionary loaded entries=${loadedWords} uniqueWords=${wordSet.size}`);

    console.log('[bot] starting DFS search...');
    const solverInput = {
      letters,
      bonusCoords: puzzle.bonusTilePositions || {},
      wordSet,
      trie,
      options: {
        useUpperBound: true,
        debugBound
      }
    };
    const solver = makeSolver(solverInput);
    const result = solver.solve();

    if (debugBound) {
      const pruneRate = result.upperChecks > 0 ? ((result.prunedUpper / result.upperChecks) * 100).toFixed(2) : '0.00';
      console.log(
        `[bound] upperChecks=${result.upperChecks} pruned=${result.prunedUpper} pruneRate=${pruneRate}% ` +
          `maxPrunedBound=${result.maxPrunedUpperBound} minAcceptedBound=${result.minAcceptedUpperBound}`
      );
      if (result.prunedUpper === 0) {
        console.log('[bound] warning: pruneUpper is 0 for this run');
        if (assertPrune) {
          throw new Error('Expected upper-bound pruning to trigger, but pruneUpper was 0');
        }
      }
      if (
        result.maxPrunedUpperBound !== null &&
        Number.isFinite(result.bestScore) &&
        result.maxPrunedUpperBound > result.bestScore
      ) {
        throw new Error(
          `Bound safety failure: pruned bound ${result.maxPrunedUpperBound} exceeded best score ${result.bestScore}`
        );
      }
    }

    if (verifyBound) {
      console.log('[bound] verification mode: running baseline search without upper-bound pruning...');
      const baseline = makeSolver({
        ...solverInput,
        options: {
          useUpperBound: false,
          debugBound: false
        }
      }).solve();
      console.log(
        `[bound] baseline bestScore=${baseline.bestScore} explored=${baseline.explored} ` +
          `durationMs=${baseline.durationMs}`
      );
      if (baseline.bestScore !== result.bestScore) {
        throw new Error(
          `Upper-bound verification failed: pruned best=${result.bestScore}, baseline best=${baseline.bestScore}`
        );
      }
      console.log('[bound] verification passed: pruned search matches baseline optimal score');
    }

    if (!result.bestBoard) {
      console.log('[bot] no valid board found');
      return;
    }

    console.log('[bot] search complete');
    console.log(
      `[bot] explored=${result.explored} durationMs=${result.durationMs} ` +
        `prunePrefix=${result.prunedPrefix} pruneWord=${result.prunedWord} pruneUpper=${result.prunedUpper}`
    );
    console.log(`[bot] final score=${result.bestScore}`);
    console.log('[bot] final board:');
    console.log(formatBoard(result.bestBoard));
    console.log('[bot] words:');
    for (const w of result.bestWords) {
      console.log(`  ${w.word}: ${w.score}`);
    }
    console.log('[bot] placed tiles payload:');
    console.log(JSON.stringify(boardToPlacedTiles(result.bestBoard), null, 2));
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

main().catch((error) => {
  console.error('[bot] failed:', error);
  process.exit(1);
});
