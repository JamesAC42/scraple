import styles from "./TileContainer.module.scss";
import Tile from "./Tile";
import { IoMdShuffle } from "react-icons/io";
import { useDroppable } from '@dnd-kit/core';

const TileContainer = ({letters, onShuffle, usedTileIds = []}) => {
    const { setNodeRef, isOver } = useDroppable({
        id: 'tile-container',
        data: {
            type: 'tile-container'
        }
    });

    return (
        <div className={styles.tileContainerWrapper}>
            <div 
                ref={setNodeRef}
                className={`${styles.tileContainer} ${isOver ? styles.isOver : ''}`}
            >
                {letters && letters.length > 0 ? (
                    letters.map((letter, index) => {
                        const tileId = `tile-${index}`;
                        // Don't render tiles that have been placed on the board
                        if (usedTileIds.includes(tileId)) {
                            return null;
                        }
                        return (
                            <Tile 
                                key={index} 
                                letter={letter} 
                                id={tileId}
                            />
                        );
                    })
                ) : (
                    <p>No letters available</p>
                )}
            </div>
            <button className={styles.shuffleButton} onClick={onShuffle}>
                <IoMdShuffle />
            </button>
        </div>
    );
}

export default TileContainer;