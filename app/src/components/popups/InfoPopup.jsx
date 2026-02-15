'use client';

import styles from "./InfoPopup.module.scss";
import { FaGithub } from "react-icons/fa";
import { MdEmail } from "react-icons/md";
import { FaXTwitter } from "react-icons/fa6";
import { useState } from "react";
import { clearStoredUserStats } from "@/lib/userStats";

const InfoPopup = ({ onClose }) => {
    const [isResetting, setIsResetting] = useState(false);

    const resetAllGameData = async () => {

        if(!confirm("Are you sure you want to reset all game data? This will delete all your progress and cannot be undone.")) {
            return;
        }

        if (isResetting) return;
        
        setIsResetting(true);
        
        if (typeof window !== 'undefined') {
            // Clear all game-related localStorage items
            localStorage.removeItem('scraple_game_state');
            localStorage.removeItem('scraple_game_date');
            localStorage.removeItem('scraple_game_results');
            localStorage.removeItem('scraple_blitz_game_state');
            localStorage.removeItem('scraple_blitz_game_date');
            localStorage.removeItem('scraple_blitz_game_results');
            localStorage.removeItem('scraple_blitz_puzzle_id');
            localStorage.removeItem('scraple_blitz_start_time');
            localStorage.removeItem('scraple_practice_game_state');
            localStorage.removeItem('scraple_practice_game_date');
            localStorage.removeItem('scraple_practice_game_results');
            localStorage.removeItem('scraple_practice_puzzle_id');
            localStorage.removeItem('scraple_practice_share_image_date');
            localStorage.removeItem('scraple_practice_share_image_data');
            localStorage.removeItem('scraple_daily_share_image_date');
            localStorage.removeItem('scraple_daily_share_image_data');
            localStorage.removeItem('scraple_blitz_share_image_date');
            localStorage.removeItem('scraple_blitz_share_image_data');
            clearStoredUserStats();
            
            // Keep the player ID as it's not related to the game state
            // localStorage.removeItem('scraple_player_id');
            
            // Set the current data version
            localStorage.setItem('scraple_data_version', '1.0.0');
            
            // Show a message to the user
            alert('All game data has been reset. The page will now reload with a fresh game.');
            
            // Reload the page to start fresh
            window.location.reload();
        }
    };

    return (
        <div className={styles.popup}>
            <p>
                Made by James
            </p>
            <div className={styles.links}>
                <a title="GitHub" href="https://github.com/JamesAC42/scraple" target="_blank" rel="noopener noreferrer">
                    <FaGithub />
                </a>
                <a title="Email" href="mailto:jamescrovo450@gmail.com">
                    <MdEmail />
                </a>
                <a title="X" href="https://x.com/fifltriggi" target="_blank" rel="noopener noreferrer">
                    <FaXTwitter />
                </a>
            </div>
            <p>
                Puzzles reset daily at 12:00 AM Eastern Time
            </p>
            <div className={styles.resetContainer}>
                <button 
                    onClick={resetAllGameData}
                    className={styles.resetButton}
                    disabled={isResetting}
                >
                    Reset All Game Data
                </button>
            </div>
        </div>
    );
}

export default InfoPopup;
