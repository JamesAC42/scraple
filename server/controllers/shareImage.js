const { Resvg } = require('@resvg/resvg-js');

const BOARD_SIZE = 5;
const CELL_SIZE = 150;
const CELL_GAP = 8;
const BOARD_PADDING = 12;

const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1400;

const BONUS_STYLES = {
  BLANK: { background: '#d6bbaa', text: '', textColor: '#000000' },
  DOUBLE_LETTER: { background: '#d0fffb', text: '2L', textColor: '#1f4f5b' },
  TRIPLE_LETTER: { background: '#117bd2', text: '3L', textColor: '#ffffff' },
  DOUBLE_WORD: { background: '#ffb0cb', text: '2W', textColor: '#5f2638' },
  TRIPLE_WORD: { background: '#e85d5d', text: '3W', textColor: '#ffffff' }
};

const XML_ESCAPE_LOOKUP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
};

const escapeXml = (value) => String(value || '').replace(/[&<>"']/g, (ch) => XML_ESCAPE_LOOKUP[ch]);

const clampToInt = (value, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
};

const sanitizeDate = (rawDate) => {
  if (typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 64);
};

const sanitizeScore = (score) => {
  const value = Number(score);
  if (!Number.isFinite(value)) return 0;
  return clampToInt(Math.round(value), -9999, 9999);
};

const normalizeBonus = (bonusTilePositions) => {
  const fallback = {};
  if (!bonusTilePositions || typeof bonusTilePositions !== 'object') {
    return fallback;
  }

  const normalized = {};
  Object.entries(bonusTilePositions).forEach(([bonusType, coords]) => {
    if (!Array.isArray(coords) || coords.length !== 2) return;

    const row = clampToInt(coords[0], 0, BOARD_SIZE - 1);
    const col = clampToInt(coords[1], 0, BOARD_SIZE - 1);
    normalized[`${row}-${col}`] = bonusType;
  });

  return normalized;
};

const sanitizeTile = (tile) => {
  if (!tile || typeof tile !== 'object') return null;

  const rawLetter = typeof tile.letter === 'string' ? tile.letter : '';
  const letter = rawLetter.trim().slice(0, 1).toUpperCase();
  if (!letter) return null;

  const points = clampToInt(tile.points, 0, 99);
  return { letter, points };
};

const normalizePlacedTiles = (placedTiles) => {
  const normalized = {};
  if (!placedTiles || typeof placedTiles !== 'object') {
    return normalized;
  }

  Object.entries(placedTiles).forEach(([key, value]) => {
    const match = key.match(/^(\d+)-(\d+)$/);
    if (!match) return;

    const row = clampToInt(match[1], 0, BOARD_SIZE - 1);
    const col = clampToInt(match[2], 0, BOARD_SIZE - 1);
    const tile = sanitizeTile(value);

    if (tile) {
      normalized[`${row}-${col}`] = tile;
    }
  });

  return normalized;
};

const formatImageDate = (dateInput) => {
  if (dateInput) return dateInput;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());
};

const getBoardCoordinates = () => {
  const boardPixelSize = BOARD_SIZE * CELL_SIZE + (BOARD_SIZE - 1) * CELL_GAP + BOARD_PADDING * 2;
  const left = Math.round((IMAGE_WIDTH - boardPixelSize) / 2);
  const top = 280;

  return {
    left,
    top,
    boardPixelSize
  };
};

const getCellRect = (boardLeft, boardTop, row, col) => {
  const x = boardLeft + BOARD_PADDING + col * (CELL_SIZE + CELL_GAP);
  const y = boardTop + BOARD_PADDING + row * (CELL_SIZE + CELL_GAP);
  return { x, y };
};

const renderCell = ({ row, col, bonusType, tile, boardLeft, boardTop }) => {
  const { x, y } = getCellRect(boardLeft, boardTop, row, col);
  const style = BONUS_STYLES[bonusType] || BONUS_STYLES.BLANK;

  let cellSvg = `
    <rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="8" fill="${style.background}" stroke="#815f4c" stroke-width="3" />
  `;

  if (style.text && !tile) {
    cellSvg += `
      <text x="${x + CELL_SIZE / 2}" y="${y + CELL_SIZE / 2 + 16}" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="800" fill="${style.textColor}">${style.text}</text>
    `;
  }

  if (tile) {
    const tileMargin = 10;
    const tileSize = CELL_SIZE - tileMargin * 2;
    const tileX = x + tileMargin;
    const tileY = y + tileMargin;
    const tileLetter = escapeXml(tile.letter);

    cellSvg += `
      <rect x="${tileX}" y="${tileY}" width="${tileSize}" height="${tileSize}" rx="8" fill="#f8e8c7" stroke="#ae8565" stroke-width="2" />
      <text x="${tileX + tileSize / 2}" y="${tileY + tileSize / 2 + 22}" text-anchor="middle" font-family="Arial, sans-serif" font-size="84" font-weight="900" fill="#56433a">${tileLetter}</text>
      <text x="${tileX + tileSize - 12}" y="${tileY + tileSize - 14}" text-anchor="end" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#56433a">${tile.points}</text>
    `;
  }

  return cellSvg;
};

const createShareSvg = ({ placedTiles, bonusTilePositions, score, date, mode }) => {
  const safeDate = escapeXml(formatImageDate(sanitizeDate(date)));
  const safeMode = mode === 'blitz' ? 'BLITZ' : 'DAILY';
  const scoreValue = sanitizeScore(score);

  const bonusByCell = normalizeBonus(bonusTilePositions);
  const safeTiles = normalizePlacedTiles(placedTiles);

  const { left: boardLeft, top: boardTop, boardPixelSize } = getBoardCoordinates();

  let cells = '';
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const key = `${row}-${col}`;
      const bonusType = bonusByCell[key] || 'BLANK';
      const tile = safeTiles[key] || null;
      cells += renderCell({ row, col, bonusType, tile, boardLeft, boardTop });
    }
  }

  return `
<svg width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8f1e8" />
      <stop offset="100%" stop-color="#e6d5c4" />
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bgGradient)" />

  <text x="540" y="120" text-anchor="middle" font-family="Arial, sans-serif" font-size="78" font-weight="900" fill="#56433a">SCRAPLE</text>
  <text x="540" y="180" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#815f4c">${safeMode} · ${safeDate}</text>

  <g>
    <rect x="${boardLeft}" y="${boardTop}" width="${boardPixelSize}" height="${boardPixelSize}" rx="12" fill="#dcc5b6" stroke="#815f4c" stroke-width="6" />
    ${cells}
  </g>

  <text x="540" y="1220" text-anchor="middle" font-family="Arial, sans-serif" font-size="60" font-weight="800" fill="#56433a">Score: ${scoreValue}</text>
  <text x="540" y="1325" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#815f4c">play now at scraple.io</text>
</svg>
`;
};

const shareImage = async (req, res) => {
  try {
    const {
      placedTiles,
      bonusTilePositions,
      score,
      date,
      mode
    } = req.body || {};

    const svg = createShareSvg({
      placedTiles,
      bonusTilePositions,
      score,
      date,
      mode
    });

    const resvg = new Resvg(svg, {
      fitTo: {
        mode: 'width',
        value: IMAGE_WIDTH
      }
    });

    const pngData = resvg.render().asPng();
    const fileDate = new Date().toISOString().slice(0, 10);
    const safeMode = mode === 'blitz' ? 'blitz' : 'daily';

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', pngData.length);
    res.setHeader('Content-Disposition', `attachment; filename="scraple-${safeMode}-${fileDate}.png"`);
    res.setHeader('Cache-Control', 'no-store');

    res.end(pngData);
  } catch (error) {
    console.error('Failed to generate share image:', error);
    res.status(500).json({ error: 'Failed to generate share image' });
  }
};

module.exports = {
  shareImage
};
