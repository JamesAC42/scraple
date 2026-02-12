'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './SharePopup.module.scss';
import { IoCopyOutline, IoDownloadOutline } from 'react-icons/io5';

const SHARE_MODE_KEY = 'scraple_share_mode';

const DAILY_DATE_KEY = 'scraple_game_date';
const BLITZ_DATE_KEY = 'scraple_blitz_game_date';
const PRACTICE_DATE_KEY = 'scraple_practice_game_date';
const DAILY_STATE_KEY = 'scraple_game_state';
const BLITZ_STATE_KEY = 'scraple_blitz_game_state';
const PRACTICE_STATE_KEY = 'scraple_practice_game_state';
const DAILY_RESULTS_KEY = 'scraple_game_results';
const BLITZ_RESULTS_KEY = 'scraple_blitz_game_results';
const PRACTICE_RESULTS_KEY = 'scraple_practice_game_results';

const DAILY_SHARE_IMAGE_DATE_KEY = 'scraple_daily_share_image_date';
const DAILY_SHARE_IMAGE_DATA_KEY = 'scraple_daily_share_image_data';
const BLITZ_SHARE_IMAGE_DATE_KEY = 'scraple_blitz_share_image_date';
const BLITZ_SHARE_IMAGE_DATA_KEY = 'scraple_blitz_share_image_data';
const PRACTICE_SHARE_IMAGE_DATE_KEY = 'scraple_practice_share_image_date';
const PRACTICE_SHARE_IMAGE_DATA_KEY = 'scraple_practice_share_image_data';

const getModeStorage = (mode) => {
  const isBlitz = mode === 'blitz';
  const isPractice = mode === 'practice';

  return {
    gameDateKey: isBlitz ? BLITZ_DATE_KEY : (isPractice ? PRACTICE_DATE_KEY : DAILY_DATE_KEY),
    gameStateKey: isBlitz ? BLITZ_STATE_KEY : (isPractice ? PRACTICE_STATE_KEY : DAILY_STATE_KEY),
    gameResultsKey: isBlitz ? BLITZ_RESULTS_KEY : (isPractice ? PRACTICE_RESULTS_KEY : DAILY_RESULTS_KEY),
    shareImageDateKey: isBlitz ? BLITZ_SHARE_IMAGE_DATE_KEY : (isPractice ? PRACTICE_SHARE_IMAGE_DATE_KEY : DAILY_SHARE_IMAGE_DATE_KEY),
    shareImageDataKey: isBlitz ? BLITZ_SHARE_IMAGE_DATA_KEY : (isPractice ? PRACTICE_SHARE_IMAGE_DATA_KEY : DAILY_SHARE_IMAGE_DATA_KEY)
  };
};

const getEtTodayString = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York'
  }).format(new Date());
};

const convertBlobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = async (dataUrl) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

const SharePopup = () => {
  const [mode, setMode] = useState('daily');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    const storedMode = localStorage.getItem(SHARE_MODE_KEY);
    setMode(storedMode === 'blitz' ? 'blitz' : (storedMode === 'practice' ? 'practice' : 'daily'));
  }, []);

  const cacheKeys = useMemo(() => getModeStorage(mode), [mode]);

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      setIsLoading(true);
      setErrorMessage('');
      setActionMessage('');

      try {
        const today = getEtTodayString();
        const cachedDate = localStorage.getItem(cacheKeys.shareImageDateKey);
        const cachedImageData = localStorage.getItem(cacheKeys.shareImageDataKey);

        if (cachedDate === today && cachedImageData) {
          if (isMounted) {
            setImageDataUrl(cachedImageData);
            setIsLoading(false);
          }
          return;
        }

        const rawState = localStorage.getItem(cacheKeys.gameStateKey);
        const rawResults = localStorage.getItem(cacheKeys.gameResultsKey);

        if (!rawState || !rawResults) {
          throw new Error('No completed game found for sharing yet.');
        }

        const gameState = JSON.parse(rawState);
        const gameResults = JSON.parse(rawResults);

        const response = await fetch('/api/share-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            placedTiles: gameState.placedTiles || {},
            bonusTilePositions: gameState.bonusTilePositions || {},
            score: gameResults.totalScore,
            date: gameState.displayDate,
            mode
          })
        });

        if (!response.ok) {
          throw new Error(`Failed to generate image: ${response.status}`);
        }

        const imageBlob = await response.blob();
        const dataUrl = await convertBlobToDataUrl(imageBlob);

        localStorage.setItem(cacheKeys.shareImageDateKey, today);
        localStorage.setItem(cacheKeys.shareImageDataKey, dataUrl);

        if (isMounted) {
          setImageDataUrl(dataUrl);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error loading share image:', error);
        if (isMounted) {
          setImageDataUrl('');
          setErrorMessage('Could not create your share image. Please try again.');
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [cacheKeys, mode]);

  const copyImageToClipboard = async () => {
    if (!imageDataUrl) return;

    try {
      if (!navigator.clipboard || !window.ClipboardItem) {
        throw new Error('Clipboard image copy is not supported in this browser.');
      }

      const blob = await dataUrlToBlob(imageDataUrl);
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      setActionMessage('Image copied to clipboard.');
    } catch (error) {
      console.error('Error copying image:', error);
      setActionMessage('Unable to copy image. You can still download it.');
    }

    setTimeout(() => {
      setActionMessage('');
    }, 3000);
  };

  const downloadImage = () => {
    if (!imageDataUrl) return;

    const dateTag = localStorage.getItem(cacheKeys.gameDateKey) || getEtTodayString();
    const modeTag = mode === 'blitz' ? 'blitz' : (mode === 'practice' ? 'practice' : 'daily');

    const link = document.createElement('a');
    link.href = imageDataUrl;
    link.download = `scraple-${modeTag}-${dateTag}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setActionMessage('Image downloaded.');
    setTimeout(() => {
      setActionMessage('');
    }, 3000);
  };

  return (
    <div className={styles.shareContainer}>
      {isLoading && <div className={styles.loading}>Generating image...</div>}

      {!isLoading && errorMessage && <div className={styles.error}>{errorMessage}</div>}

      {!isLoading && !errorMessage && imageDataUrl && (
        <>
          <img className={styles.shareImage} src={imageDataUrl} alt="Shareable board image" />
          <div className={styles.actions}>
            <button
              className={styles.copyButton}
              onClick={copyImageToClipboard}
              data-umami-event="Copy image in share popup"
            >
              <IoCopyOutline />
              <span>Copy Image</span>
            </button>
            <button
              className={styles.downloadButton}
              onClick={downloadImage}
              data-umami-event="Download image in share popup"
            >
              <IoDownloadOutline />
              <span>Download Image</span>
            </button>
          </div>
          {actionMessage && <div className={styles.actionMessage}>{actionMessage}</div>}
        </>
      )}
    </div>
  );
};

export default SharePopup;
