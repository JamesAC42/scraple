const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const BOARD_SIZE = 5;
const CELL_SIZE = 150;
const CELL_GAP = 8;
const BOARD_PADDING = 12;

const IMAGE_WIDTH = 1080;
const IMAGE_HEIGHT = 1400;
const MANROPE_FONT_PATH = path.resolve(__dirname, '../../app/public/fonts/Manrope/Manrope.ttf');
const LOGO_PATH = path.resolve(__dirname, '../../app/public/images/logo.png');
const FONT_FAMILY = 'Manrope';
const BOLD_STROKE_OPACITY = 0.72;

const BONUS_STYLES = {
  BLANK: { background: '#d6bbaa', text: '', textColor: '#000000' },
  DOUBLE_LETTER: { background: '#d0fffb', text: '2L', textColor: '#1f4f5b' },
  TRIPLE_LETTER: { background: '#117bd2', text: '3L', textColor: '#ffffff' },
  DOUBLE_WORD: { background: '#ffb0cb', text: '2W', textColor: '#5f2638' },
  TRIPLE_WORD: { background: '#e85d5d', text: '3W', textColor: '#ffffff' }
};

let logoDataUri = '';
try {
  const logoBuffer = fs.readFileSync(LOGO_PATH);
  logoDataUri = `data:image/png;base64,${logoBuffer.toString('base64')}`;
} catch (error) {
  console.warn('Share image logo not found, continuing without logo:', error.message);
}

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

const getScoreLabelMeta = (score) => {
  if (score < 50) return { label: 'You tried', color: '#d64545' };
  if (score < 80) return { label: 'Good start', color: '#e26e2d' };
  if (score < 110) return { label: 'Great', color: '#ea9a24' };
  if (score < 140) return { label: 'Excellent', color: '#38a3a5' };
  if (score < 170) return { label: 'Outstanding', color: '#2e9f44' };
  return { label: 'Exceptional', color: '#0a7b30' };
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
      <text x="${x + CELL_SIZE / 2}" y="${y + CELL_SIZE / 2 + 16}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="42" font-weight="900" fill="${style.textColor}" stroke="${style.textColor}" stroke-width="3" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">${style.text}</text>
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
      <text x="${tileX + tileSize / 2}" y="${tileY + tileSize / 2 + 16}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="50" font-weight="900" fill="#56433a" stroke="#56433a" stroke-width="4" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">${tileLetter}</text>
      <text x="${tileX + tileSize - 12}" y="${tileY + tileSize - 14}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="30" font-weight="900" fill="#56433a" stroke="#56433a" stroke-width="1.6" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">${tile.points}</text>
    `;
  }

  return cellSvg;
};

const createShareSvg = ({ placedTiles, bonusTilePositions, score, date, mode }) => {
  const safeDate = escapeXml(formatImageDate(sanitizeDate(date)));
  const isPracticeMode = mode === 'practice';
  const safeMode = mode === 'blitz' ? 'BLITZ' : (isPracticeMode ? 'PRACTICE' : 'DAILY');
  const headerLine = isPracticeMode ? 'PRACTICE GAME' : `${safeMode} · ${safeDate}`;
  const scoreValue = sanitizeScore(score);
  const { label: scoreLabel, color: labelColor } = getScoreLabelMeta(scoreValue);

  const bonusByCell = normalizeBonus(bonusTilePositions);
  const safeTiles = normalizePlacedTiles(placedTiles);

  const { left: boardLeft, top: boardTop, boardPixelSize } = getBoardCoordinates();
  const headerX = 540;
  const logoSize = 86;
  const logoTitleGap = 10;
  const titleWidthEstimate = 360;
  const titleGroupWidth = logoSize + logoTitleGap + titleWidthEstimate;
  const titleGroupStartX = Math.round((IMAGE_WIDTH - titleGroupWidth) / 2);
  const logoX = titleGroupStartX;
  const logoY = 58;
  const titleStartX = logoX + logoSize + logoTitleGap;

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
      <stop offset="0%" stop-color="#e8f4ff" />
      <stop offset="100%" stop-color="#8fc7f8" />
    </linearGradient>
    <linearGradient id="ctaGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2e7fe5" />
      <stop offset="100%" stop-color="#4b99f9" />
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bgGradient)" />
  ${logoDataUri ? `<image href="${logoDataUri}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" />` : ''}
  <text x="${titleStartX}" y="128" text-anchor="start" font-family="${FONT_FAMILY}" font-size="78" font-weight="900" fill="#25486d" stroke="#25486d" stroke-width="4.8" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">SCRAPLE</text>
  <text x="${headerX}" y="182" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="34" font-weight="900" fill="#35638f" stroke="#35638f" stroke-width="1.8" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">${headerLine}</text>
  <text x="${headerX}" y="232" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="38" font-weight="900" fill="#1f4d78" stroke="#1f4d78" stroke-width="2" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">Can you beat my score of ${scoreValue}?</text>

  <g>
    <rect x="${boardLeft}" y="${boardTop}" width="${boardPixelSize}" height="${boardPixelSize}" rx="12" fill="#dcc5b6" stroke="#815f4c" stroke-width="6" />
    ${cells}
  </g>

  <text x="${headerX}" y="1206" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="62" font-weight="900" fill="#234d78" stroke="#234d78" stroke-width="2.4" stroke-opacity="${BOLD_STROKE_OPACITY}" paint-order="stroke fill">Score: ${scoreValue}<tspan dx="10" fill="${labelColor}" stroke="${labelColor}" stroke-width="2.4">${escapeXml(scoreLabel)}</tspan></text>

  <g transform="translate(282,1262)">
    <rect x="0" y="0" width="516" height="84" rx="42" fill="url(#ctaGradient)" />
    <rect x="0" y="0" width="516" height="84" rx="42" fill="none" stroke="#195ea8" stroke-width="2"/>
    <text x="258" y="54" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="40" font-weight="900" fill="#ffffff" stroke="#ffffff" stroke-width="1.8" stroke-opacity="0.56" paint-order="stroke fill">Beat me at scraple.io</text>
  </g>
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
      },
      font: {
        fontFiles: [MANROPE_FONT_PATH],
        loadSystemFonts: false,
        defaultFontFamily: FONT_FAMILY
      }
    });

    const pngData = resvg.render().asPng();
    const fileDate = new Date().toISOString().slice(0, 10);
    const safeMode = mode === 'blitz' ? 'blitz' : (mode === 'practice' ? 'practice' : 'daily');

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
