export const PLAYER_ID_KEY = 'scraple_player_id';
export const PLAYER_NICKNAME_KEY = 'scraple_player_nickname';
export const NICKNAME_PROMPT_DISMISSED_KEY = 'scraple_nickname_prompt_dismissed';
export const NICKNAME_MAX_LENGTH = 10;

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
  'rapist'
];

export const collapseNicknameWhitespace = (value) => {
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

export const validateNickname = (nickname) => {
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

export const getPlayerHash = (playerId) => {
  const raw = String(playerId || '');
  let hash = 5381;

  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }

  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
};

export const getNicknameBadgeStyle = (hash) => {
  const sanitizedHash = String(hash || '').toUpperCase() || '000000';
  const seed = parseInt(sanitizedHash, 36) || 0;
  const hue = seed % 360;
  const radius = 8 + (seed % 7);

  return {
    backgroundColor: `hsl(${hue} 75% 92%)`,
    borderColor: `hsl(${hue} 60% 62%)`,
    borderRadius: `${radius}px`
  };
};

export const getStoredNickname = () => {
  if (typeof window === 'undefined') return '';
  return collapseNicknameWhitespace(localStorage.getItem(PLAYER_NICKNAME_KEY) || '');
};

export const setStoredNickname = (nickname) => {
  if (typeof window === 'undefined') return;
  const cleaned = collapseNicknameWhitespace(nickname);
  if (!cleaned) {
    localStorage.removeItem(PLAYER_NICKNAME_KEY);
    return;
  }
  localStorage.setItem(PLAYER_NICKNAME_KEY, cleaned);
};

export const hasDismissedNicknamePrompt = () => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(NICKNAME_PROMPT_DISMISSED_KEY) === '1';
};

export const setNicknamePromptDismissed = (dismissed) => {
  if (typeof window === 'undefined') return;
  if (dismissed) {
    localStorage.setItem(NICKNAME_PROMPT_DISMISSED_KEY, '1');
    return;
  }
  localStorage.removeItem(NICKNAME_PROMPT_DISMISSED_KEY);
};

export const saveNicknameToServer = async ({ playerId, nickname }) => {
  const response = await fetch('/api/player/nickname', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ playerId, nickname: collapseNicknameWhitespace(nickname) })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to save nickname');
  }

  return data;
};
