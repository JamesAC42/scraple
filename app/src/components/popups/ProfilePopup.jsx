'use client';

import { useEffect, useState } from 'react';
import styles from './ProfilePopup.module.scss';
import {
  PLAYER_ID_KEY,
  NICKNAME_MAX_LENGTH,
  getPlayerHash,
  getStoredNickname,
  saveNicknameToServer,
  setStoredNickname,
  validateNickname
} from '@/lib/nickname';
import { getStoredStreakState } from '@/lib/streaks';

const ProfilePopup = () => {
  const [playerId, setPlayerId] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [dailyStreak, setDailyStreak] = useState(0);
  const [blitzStreak, setBlitzStreak] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedPlayerId = localStorage.getItem(PLAYER_ID_KEY) || '';
    setPlayerId(storedPlayerId);
    setNickname(getStoredNickname());
    setDailyStreak(getStoredStreakState('daily').count);
    setBlitzStreak(getStoredStreakState('blitz').count);
  }, []);

  useEffect(() => {
    const syncStreaks = () => {
      setDailyStreak(getStoredStreakState('daily').count);
      setBlitzStreak(getStoredStreakState('blitz').count);
    };

    window.addEventListener('scraple:streak-updated', syncStreaks);
    window.addEventListener('storage', syncStreaks);
    return () => {
      window.removeEventListener('scraple:streak-updated', syncStreaks);
      window.removeEventListener('storage', syncStreaks);
    };
  }, []);

  const handleSave = async () => {
    setError('');
    setSavedMessage('');

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
      setStoredNickname(data.nickname || validation.value);
      setNickname(data.nickname || validation.value);
      setSavedMessage('Nickname updated.');
      window.dispatchEvent(new CustomEvent('scraple:nickname-updated'));
    } catch (saveError) {
      setError(saveError.message || 'Failed to save nickname.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveNickname = async () => {
    setError('');
    setSavedMessage('');

    if (!playerId) {
      setError('Unable to remove nickname right now.');
      return;
    }

    setIsSaving(true);
    try {
      await saveNicknameToServer({
        playerId,
        nickname: ''
      });
      setStoredNickname('');
      setNickname('');
      setSavedMessage('Nickname removed.');
      window.dispatchEvent(new CustomEvent('scraple:nickname-updated'));
    } catch (saveError) {
      setError(saveError.message || 'Failed to remove nickname.');
    } finally {
      setIsSaving(false);
    }
  };

  const playerHash = getPlayerHash(playerId);

  return (
    <div className={styles.profileContainer}>
      <p className={styles.profileHint}>
        Your leaderboard identity is your nickname plus ID hash.
      </p>
      <div className={styles.streakSection}>
        <div className={styles.streakItem}>
          Daily streak: <strong>🔥 {dailyStreak}</strong>
        </div>
        <div className={styles.streakItem}>
          Blitz streak: <strong>🔥 {blitzStreak}</strong>
        </div>
      </div>
      <div className={styles.hashRow}>ID hash: <strong>#{playerHash}</strong></div>
      <label className={styles.fieldLabel} htmlFor="profile-nickname-input">
        Nickname
      </label>
      <input
        id="profile-nickname-input"
        className={styles.nicknameInput}
        value={nickname}
        maxLength={NICKNAME_MAX_LENGTH}
        onChange={(event) => {
          setNickname(event.target.value);
          setError('');
          setSavedMessage('');
        }}
        placeholder="Enter nickname"
      />
      <div className={styles.inputMeta}>{nickname.length}/{NICKNAME_MAX_LENGTH}</div>

      {error && <div className={styles.error}>{error}</div>}
      {savedMessage && <div className={styles.saved}>{savedMessage}</div>}

      <div className={styles.actions}>
        <button className={styles.saveButton} onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button
          className={styles.removeButton}
          onClick={handleRemoveNickname}
          disabled={isSaving || !nickname.trim()}
        >
          Remove nickname
        </button>
      </div>
    </div>
  );
};

export default ProfilePopup;
