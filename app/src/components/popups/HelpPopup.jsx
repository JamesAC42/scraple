'use client';

import styles from "./HelpPopup.module.scss";
import Tile from "../board/Tile";

const HelpPopup = ({ onClose }) => {
    return (
        <div className={styles.popup}>
            <p>Make as many words as possible!</p>
            <ul>
                <li>
                    <p>Drag letters onto the board to form words.</p>
                </li>
                <li>
                    <p>Words must be at least <span className={styles.bold}>2 letters</span> long.</p>
                </li>
                <li>
                    <p>Letters must be adjacent to another letter.</p>
                </li>
                <li>
                    <p>Words can intersect and go downwards or to the right.</p>
                </li>
                <li>
                    <p>Points are deducted for invalid words!</p>
                </li>
            </ul>
            <p className={styles.center}>Once you place a letter, it cannot be moved.</p>
            <p className={styles.center}>You get one board reset per game.</p>
            <div className={styles.tileExplanation}>
                <div className={styles.tileOuter}>  
                    <Tile letter={{letter:"A", points:1}} />
                </div>
                <div className={styles.tileExplanationText}>
                    Points for each letter are denoted on the bottom right of the tile.
                </div>
            </div>
            <div className={styles.cellExplanation}>
                <div className={styles.cellsOuter}>
                    <div className={styles.cellsGrid}>
                        <div className={`${styles.bonusCell} ${styles.doubleWord}`}>
                            <div>DOUBLE WORD</div>
                        </div>
                        <div className={`${styles.bonusCell} ${styles.tripleWord}`}>
                            <div>TRIPLE WORD</div>
                        </div>
                        <div className={`${styles.bonusCell} ${styles.doubleLetter}`}>
                            <div>DOUBLE LETTER</div>
                        </div>
                        <div className={`${styles.bonusCell} ${styles.tripleLetter}`}>
                            <div>TRIPLE LETTER</div>
                        </div>
                    </div>
                </div>
                <div className={styles.cellExplanationText}>
                    Special cells award bonus points for letters or words formed over them. 
                </div>
            </div>
            <p className={styles.center}>
                When you give up, click <span className={styles.finish}>Finish</span> to get your score!
            </p>
        </div>
    );  
}

export default HelpPopup;