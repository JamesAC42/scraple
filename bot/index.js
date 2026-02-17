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

const BOT_SUPPRESS_LOGS = process.env.BOT_SUPPRESS_LOGS === '1';
const BOT_OUTPUT_JSON = process.env.BOT_OUTPUT_JSON === '1';
if (BOT_SUPPRESS_LOGS) {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}

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

  step(node, letterIdx) {
    const e = this.findEdge(node, letterIdx);
    return e === 0xffffffff ? -1 : this.edgeTo[e];
  }

  isWordNode(node) {
    return node >= 0 && this.nodeIsWord[node] === 1;
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
      trie.insertWord(rawWord);
      loadedWords += 1;
    }
  } while (cursor !== '0');

  return { trie, loadedWords };
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

function toBoardRows(board) {
  const rows = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const current = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const v = board[cellIndex(row, col)];
      current.push(isLetter(v) ? decodeLetter(v) : null);
    }
    rows.push(current);
  }
  return rows;
}

function makeSolver({ letters, bonusCoords, trie, options = {} }) {
  const useUpperBound = options.useUpperBound !== false;
  const useMemo = options.useMemo !== false;
  const configuredTimeLimit = Number(options.timeLimitMs ?? process.env.TIME_LIMIT_MS ?? 15000);
  const configuredNodeLimit = Number(options.nodeLimit ?? process.env.NODE_LIMIT ?? 0);
  const configuredMemoMaxEntries = Number(options.memoMaxEntries ?? process.env.MEMO_MAX_ENTRIES ?? 250000);
  const configuredMemoMinCell = Number(options.memoMinCell ?? process.env.MEMO_MIN_CELL ?? 10);
  const timeLimitMs = Number.isFinite(configuredTimeLimit) && configuredTimeLimit > 0 ? configuredTimeLimit : 15000;
  const nodeLimit = Number.isFinite(configuredNodeLimit) && configuredNodeLimit > 0 ? Math.floor(configuredNodeLimit) : 0;
  const memoMaxEntries =
    Number.isFinite(configuredMemoMaxEntries) && configuredMemoMaxEntries > 1000
      ? Math.floor(configuredMemoMaxEntries)
      : 250000;
  const memoMinCell =
    Number.isFinite(configuredMemoMinCell) && configuredMemoMinCell >= 0 && configuredMemoMinCell < CELL_COUNT
      ? Math.floor(configuredMemoMinCell)
      : 10;

  const board = new Uint8Array(CELL_COUNT);
  board.fill(UNASSIGNED);

  const counts = buildRackCounts(letters);
  const totalRackLetters = counts.reduce((sum, n) => sum + n, 0);

  const { letterMult, wordMult } = buildBonusMaps(bonusCoords);

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestBoard = null;
  let bestWords = [];
  let timedOut = false;
  let timeoutReason = null;

  let explored = 0;
  let prunedPrefix = 0;
  let prunedWord = 0;
  let prunedUpper = 0;
  let prunedMemo = 0;
  let memoHits = 0;
  let memoResets = 0;
  let memoStores = 0;
  let progress = null;
  let upperChecks = 0;
  let minAcceptedUpperBound = Number.POSITIVE_INFINITY;
  let maxPrunedUpperBound = Number.NEGATIVE_INFINITY;
  let placedLetterBase = 0;
  const memoByCell = useMemo ? Array.from({ length: CELL_COUNT + 1 }, () => new Map()) : null;
  let memoEntries = 0;

  const rowWordBound = new Uint8Array(BOARD_SIZE);
  const colWordBound = new Uint8Array(BOARD_SIZE);
  const coeffBuckets = new Uint16Array(64);
  const pointBuckets = new Uint16Array(11);
  const POINT_ORDER = [10, 8, 5, 4, 3, 2, 1];
  const downNodes = new Uint32Array(BOARD_SIZE);
  const downLens = new Uint8Array(BOARD_SIZE);
  const letterOrderByMultiplier = [[], [], [], []];

  for (let mult = 1; mult <= 3; mult += 1) {
    const order = [];
    for (let li = 0; li < 26; li += 1) order.push(li);
    order.sort((a, b) => {
      const av = LETTER_POINTS[a] * mult;
      const bv = LETTER_POINTS[b] * mult;
      if (bv !== av) return bv - av;
      return a - b;
    });
    letterOrderByMultiplier[mult] = order;
  }

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

  function makeMemoKey(acrossNode, acrossLen) {
    // Use base-36 tokens to keep key length compact.
    let key = `${acrossNode.toString(36)}.${acrossLen.toString(36)}|`;
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      key += `${downNodes[c].toString(36)}.${downLens[c].toString(36)}|`;
    }
    for (let li = 0; li < 26; li += 1) {
      const cnt = counts[li];
      if (cnt > 0) key += `${li.toString(36)}.${cnt.toString(36)},`;
    }
    return key;
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
          let node = 0;
          const positions = [];
          for (let c = col; c <= endCol; c += 1) {
            const idx = cellIndex(row, c);
            const li = board[idx];
            node = trie.step(node, li);
            if (node < 0) return null;
            word += decodeLetter(li);
            raw += LETTER_POINTS[li] * letterMult[idx];
            mult *= wordMult[idx];
            positions.push({ row, col: c });
          }
          if (!trie.isWordNode(node)) return null;
          const score = raw * mult;
          total += score;
          words.push({ word, score, positions });
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
          let node = 0;
          const positions = [];
          for (let r = row; r <= endRow; r += 1) {
            const idx = cellIndex(r, col);
            const li = board[idx];
            node = trie.step(node, li);
            if (node < 0) return null;
            word += decodeLetter(li);
            raw += LETTER_POINTS[li] * letterMult[idx];
            mult *= wordMult[idx];
            positions.push({ row: r, col });
          }
          if (!trie.isWordNode(node)) return null;
          const score = raw * mult;
          total += score;
          words.push({ word, score, positions });
        }
        row = endRow + 1;
      }
    }

    return { total, words };
  }

  function dfs(cell, acrossNode, acrossLen) {
    if (timedOut) return;

    const now = Date.now();
    if (now > progress.deadline) {
      timedOut = true;
      timeoutReason = 'time';
      return;
    }
    if (progress.nodeLimit > 0 && explored >= progress.nodeLimit) {
      timedOut = true;
      timeoutReason = 'node';
      return;
    }

    if (progress) {
      if (now - progress.lastLogAt >= progress.intervalMs) {
        progress.lastLogAt = now;
        console.log(
          `[search] explored=${explored} best=${Number.isFinite(bestScore) ? bestScore : 'N/A'} ` +
            `prunePrefix=${prunedPrefix} pruneWord=${prunedWord} pruneUpper=${prunedUpper} pruneMemo=${prunedMemo}`
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

    const col = cellCol(cell);
    const row = cellRow(cell);
    if (col === 0) {
      acrossNode = 0;
      acrossLen = 0;
    }

    if (useMemo && cell >= memoMinCell) {
      if (memoEntries >= memoMaxEntries) {
        for (let i = memoMinCell; i <= CELL_COUNT; i += 1) memoByCell[i].clear();
        memoEntries = 0;
        memoResets += 1;
      }

      const memoKey = makeMemoKey(acrossNode, acrossLen);
      const memoForCell = memoByCell[cell];
      const seenPlacedBase = memoForCell.get(memoKey);
      if (seenPlacedBase !== undefined && placedLetterBase <= seenPlacedBase) {
        prunedMemo += 1;
        memoHits += 1;
        return;
      }
      if (seenPlacedBase === undefined) {
        memoEntries += 1;
        memoStores += 1;
      }
      memoForCell.set(memoKey, placedLetterBase);
    }

    const letterOrder = letterOrderByMultiplier[letterMult[cell]] || letterOrderByMultiplier[1];
    for (let k = 0; k < letterOrder.length; k += 1) {
      const letter = letterOrder[k];
      if (counts[letter] === 0) continue;

      const nextAcrossNode = trie.step(acrossNode, letter);
      if (nextAcrossNode < 0) {
        prunedPrefix += 1;
        continue;
      }
      const nextAcrossLen = acrossLen + 1;
      if (col === BOARD_SIZE - 1 && nextAcrossLen >= MIN_WORD_LEN && !trie.isWordNode(nextAcrossNode)) {
        prunedWord += 1;
        continue;
      }

      const prevDownNode = downNodes[col];
      const prevDownLen = downLens[col];
      const nextDownNode = trie.step(prevDownNode, letter);
      if (nextDownNode < 0) {
        prunedPrefix += 1;
        continue;
      }
      const nextDownLen = prevDownLen + 1;
      if (row === BOARD_SIZE - 1 && nextDownLen >= MIN_WORD_LEN && !trie.isWordNode(nextDownNode)) {
        prunedWord += 1;
        continue;
      }

      board[cell] = letter;
      counts[letter] -= 1;
      placedLetterBase += LETTER_POINTS[letter] * letterMult[cell];
      downNodes[col] = nextDownNode;
      downLens[col] = nextDownLen;

      if (!useUpperBound) {
        dfs(cell + 1, nextAcrossNode, nextAcrossLen);
      } else {
        const bound = estimateUpperBound();
        upperChecks += 1;
        if (bound > bestScore) {
          if (bound < minAcceptedUpperBound) minAcceptedUpperBound = bound;
          dfs(cell + 1, nextAcrossNode, nextAcrossLen);
        } else {
          prunedUpper += 1;
          if (bound > maxPrunedUpperBound) maxPrunedUpperBound = bound;
        }
      }

      downNodes[col] = prevDownNode;
      downLens[col] = prevDownLen;
      counts[letter] += 1;
      placedLetterBase -= LETTER_POINTS[letter] * letterMult[cell];
      board[cell] = UNASSIGNED;

      if (timedOut) return;
    }

    const prevDownNode = downNodes[col];
    const prevDownLen = downLens[col];
    if (
      (acrossLen < MIN_WORD_LEN || trie.isWordNode(acrossNode)) &&
      (prevDownLen < MIN_WORD_LEN || trie.isWordNode(prevDownNode))
    ) {
      board[cell] = EMPTY;
      downNodes[col] = 0;
      downLens[col] = 0;

      if (!useUpperBound) {
        dfs(cell + 1, 0, 0);
      } else {
        const bound = estimateUpperBound();
        upperChecks += 1;
        if (bound > bestScore) {
          if (bound < minAcceptedUpperBound) minAcceptedUpperBound = bound;
          dfs(cell + 1, 0, 0);
        } else {
          prunedUpper += 1;
          if (bound > maxPrunedUpperBound) maxPrunedUpperBound = bound;
        }
      }

      downNodes[col] = prevDownNode;
      downLens[col] = prevDownLen;
      board[cell] = UNASSIGNED;
    } else {
      prunedWord += 1;
    }
  }

  function solve() {
    const startedAt = Date.now();
    progress = {
      lastLogAt: startedAt,
      intervalMs: 3000,
      debugBound: options.debugBound === true,
      deadline: startedAt + timeLimitMs,
      nodeLimit
    };
    dfs(0, 0, 0);
    progress = null;

    return {
      bestScore,
      bestBoard,
      bestWords,
      timedOut,
      timeoutReason,
      timeLimitMs,
      nodeLimit,
      memoMaxEntries,
      memoMinCell,
      explored,
      prunedPrefix,
      prunedWord,
      prunedUpper,
      prunedMemo,
      memoHits,
      memoStores,
      memoResets,
      memoSize: memoEntries,
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
  const envDate = typeof process.env.BOT_PUZZLE_DATE === 'string' ? process.env.BOT_PUZZLE_DATE.trim() : '';
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(envDate) ? envDate : getEasternDateString();
  const redisKey = `${DAILY_PUZZLE_PREFIX}${targetDate}`;
  const raw = await redisClient.get(redisKey);
  if (!raw) {
    throw new Error(`No puzzle found in Redis at key "${redisKey}"`);
  }
  const parsed = JSON.parse(raw);
  return { today: targetDate, redisKey, puzzle: parsed };
}

function emitJson(payload) {
  if (!BOT_OUTPUT_JSON) return;
  process.stdout.write(`BOT_RESULT_JSON:${JSON.stringify(payload)}\n`);
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

    console.log('[bot] loading dictionary from redis and building trie...');
    const { trie, loadedWords } = await loadDictionary(redisClient);
    console.log(`[bot] dictionary loaded entries=${loadedWords}`);

    console.log('[bot] starting DFS search...');
    const solverInput = {
      letters,
      bonusCoords: puzzle.bonusTilePositions || {},
      trie,
      options: {
        useUpperBound: true,
        useMemo: true,
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
      console.log(
        `[memo] enabled=${solverInput.options.useMemo !== false} memoSize=${result.memoSize} ` +
          `stores=${result.memoStores} resets=${result.memoResets} maxEntries=${result.memoMaxEntries} minCell=${result.memoMinCell}`
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
      if (baseline.timedOut || result.timedOut) {
        console.log('[bound] verification skipped strict equality because one run timed out');
      } else if (baseline.bestScore !== result.bestScore) {
        throw new Error(
          `Upper-bound verification failed: pruned best=${result.bestScore}, baseline best=${baseline.bestScore}`
        );
      } else {
        console.log('[bound] verification passed: pruned search matches baseline optimal score');
      }
    }

    if (!result.bestBoard) {
      console.log('[bot] no valid board found');
      console.log(
        `[bot] timedOut=${result.timedOut} timeoutReason=${result.timeoutReason || 'none'} ` +
          `timeLimitMs=${result.timeLimitMs} nodeLimit=${result.nodeLimit || 0}`
      );
      emitJson({
        ok: false,
        date: today,
        score: null,
        timedOut: result.timedOut,
        timeoutReason: result.timeoutReason || null,
        explored: result.explored,
        durationMs: result.durationMs,
        bonusTilePositions: puzzle.bonusTilePositions || {},
        placedTiles: {}
      });
      return;
    }

    console.log('[bot] search complete');
    console.log(
      `[bot] explored=${result.explored} durationMs=${result.durationMs} ` +
        `prunePrefix=${result.prunedPrefix} pruneWord=${result.prunedWord} ` +
        `pruneUpper=${result.prunedUpper} pruneMemo=${result.prunedMemo} ` +
        `memoSize=${result.memoSize} memoResets=${result.memoResets}`
    );
    console.log(
      `[bot] timedOut=${result.timedOut} timeoutReason=${result.timeoutReason || 'none'} ` +
        `timeLimitMs=${result.timeLimitMs} nodeLimit=${result.nodeLimit || 0}`
    );
    console.log(`[bot] final score=${result.bestScore}`);
    console.log('[bot] final board:');
    console.log(formatBoard(result.bestBoard));
    console.log('[bot] words:');
    for (const w of result.bestWords) {
      console.log(`  ${w.word}: ${w.score}`);
    }
    console.log('[bot] placed tiles payload:');
    const placedTiles = boardToPlacedTiles(result.bestBoard);
    console.log(JSON.stringify(placedTiles, null, 2));

    emitJson({
      ok: true,
      date: today,
      score: result.bestScore,
      timedOut: result.timedOut,
      timeoutReason: result.timeoutReason || null,
      explored: result.explored,
      durationMs: result.durationMs,
      bonusTilePositions: puzzle.bonusTilePositions || {},
      placedTiles,
      boardRows: toBoardRows(result.bestBoard),
      words: result.bestWords
    });
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

main().catch((error) => {
  emitJson({
    ok: false,
    error: error && error.message ? error.message : String(error)
  });
  console.error('[bot] failed:', error);
  process.exit(1);
});
