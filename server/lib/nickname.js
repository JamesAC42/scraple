const NICKNAME_MAX_LENGTH = 10;
const PLAYER_NICKNAME_HASH_KEY = 'scraple:player:nicknames';

const RESERVED_TERMS = new Set([
  'admin',
  'administrator',
  'mod',
  'moderator',
  'owner',
  'staff',
  'system',
  'support'
]);

const BLOCKED_TERMS = [
  'nigger',
  'nigga',
  'faggot',
  'kike',
  'chink',
  'spic',
  'wetback',
  'tranny',
  'retard',
  'whore',
  'slut',
  'bitch',
  'shit',
  'fuck',
  'cunt',
  'dick',
  'pussy',
  'cock',
  'nazi',
  'rapist'
];

const collapseNicknameWhitespace = (value) => {
  return String(value || '').replace(/\s+/g, ' ').trim();
};

const normalizeForModeration = (value) => {
  return String(value || '')
    .toLowerCase()
    .replace(/[@]/g, 'a')
    .replace(/[!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[1]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9]/g, '');
};

const validateNickname = (nickname) => {
  const cleaned = collapseNicknameWhitespace(nickname);

  if (!cleaned) {
    return { valid: false, error: 'Nickname is required.' };
  }

  if (cleaned.length > NICKNAME_MAX_LENGTH) {
    return { valid: false, error: `Nickname must be ${NICKNAME_MAX_LENGTH} characters or fewer.` };
  }

  if (!/^[A-Za-z0-9 _-]+$/.test(cleaned)) {
    return { valid: false, error: 'Use letters, numbers, spaces, hyphens, or underscores only.' };
  }

  const lowerCleaned = cleaned.toLowerCase();
  const normalized = normalizeForModeration(cleaned);

  if (RESERVED_TERMS.has(lowerCleaned) || RESERVED_TERMS.has(normalized)) {
    return { valid: false, error: 'That nickname is not allowed.' };
  }

  const isBlocked = BLOCKED_TERMS.some((term) => {
    return lowerCleaned.includes(term) || normalized.includes(term);
  });

  if (isBlocked) {
    return { valid: false, error: 'That nickname is not allowed.' };
  }

  return { valid: true, value: cleaned };
};

const getPlayerHash = (playerId) => {
  const raw = String(playerId || '');
  let hash = 5381;

  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }

  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
};

module.exports = {
  NICKNAME_MAX_LENGTH,
  PLAYER_NICKNAME_HASH_KEY,
  validateNickname,
  getPlayerHash
};
