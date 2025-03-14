import styles from "./BoardCell.module.scss";
import CellTypes from "@/types/CellTypes";
import { useDroppable } from '@dnd-kit/core';
import Tile from './Tile';

const BoardCell = ({type, id, placedTile, position, isValidTarget, isDragging}) => {
    const { setNodeRef, isOver } = useDroppable({
        id: id || `cell-${position?.row}-${position?.col}`,
        data: { position }
    });

    const cellClass = styles[type];

    const cellContent = () => {
        switch (type) {
            case CellTypes.BLANK:
                return null;
            case CellTypes.DOUBLE_LETTER:
                return <div className={styles.doubleLetter}>
                    DOUBLE LETTER
                </div>  
            case CellTypes.TRIPLE_LETTER:
                return <div className={styles.tripleLetter}>
                    TRIPLE LETTER
                </div>
            case CellTypes.DOUBLE_WORD:
                return <div className={styles.doubleWord}>
                    DOUBLE WORD
                </div>
            case CellTypes.TRIPLE_WORD:
                return <div className={styles.tripleWord}>
                    TRIPLE WORD
                </div>
            default:
                return null;
        }
    }

    // Only show valid target styling when actively dragging
    const showValidTarget = isDragging && isValidTarget && !placedTile;

    return (
        <div 
            ref={setNodeRef}
            className={`
                ${styles.boardCell} 
                ${cellClass} 
                ${isOver ? styles.isOver : ''} 
                ${showValidTarget ? styles.validTarget : ''}
            `}
        >
            {!placedTile && cellContent()}
            {placedTile && (
                <Tile 
                    letter={placedTile} 
                    id={`placed-${position?.row}-${position?.col}`} 
                    position={position}
                />
            )}
        </div>
    )
}

export default BoardCell;