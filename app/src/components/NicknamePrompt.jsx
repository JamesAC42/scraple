'use client';

import { useMemo, useState } from 'react';
import styles from './NicknamePrompt.module.scss';
import {
  NICKNAME_MAX_LENGTH,
  getPlayerHash,
  saveNicknameToServer,
  setStoredNickname,
  validateNickname
} from '@/lib/nickname';

const NicknamePrompt = ({ playerId, onDismiss, onSaved }) => {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const playerHash = useMemo(() => getPlayerHash(playerId), [playerId]);

  const handleSubmit = async () => {
    setError('');

    const validation = validateNickname(nickname);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    if (!playerId) {
      setError('Unable to save nickname right now.');
      return;
    }

    setIsSaving(true);
    try {
      const data = await saveNicknameToServer({
        playerId,
        nickname: validation.value
      });
      const savedNickname = data.nickname || validation.value;
      setStoredNickname(savedNickname);
      window.dispatchEvent(new CustomEvent('scraple:nickname-updated'));
      onSaved(savedNickname);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save nickname.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h3>Enter a nickname that will appear on the leaderboard</h3>
        <input
          className={styles.input}
          value={nickname}
          maxLength={NICKNAME_MAX_LENGTH}
          onChange={(event) => {
            setNickname(event.target.value);
            setError('');
          }}
          placeholder="Nickname"
        />
        <div className={styles.charCount}>{nickname.length}/{NICKNAME_MAX_LENGTH}</div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.explainerGraphic}>
          <div className={styles.explainerTitle}>Leaderboard Identity</div>
          <div className={styles.identityChipRow}>
            <span className={styles.nameChip}>{nickname.trim() || 'your-nickname'}</span>
            <span className={styles.hashChip}>#{playerHash}</span>
          </div>
          <p>
            Your nickname appears with a short hash from your player ID so other players can spot your streaks.
          </p>
        </div>

        <div className={styles.actions}>
          <button className={styles.enterButton} onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Enter'}
          </button>
          <button className={styles.noThanksButton} onClick={onDismiss} disabled={isSaving}>
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
};

export default NicknamePrompt;
