import styles from "./Tile.module.scss";
import TileTypes from "@/types/TileTypes";
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

const Tile = ({letter, id}) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: id || `tile-${Math.random()}`,
        data: { letter }
    });

    // Improved transform handling for smoother dragging
    const style = transform ? {
        transform: CSS.Transform.toString({
            ...transform,
            scaleX: 1,
            scaleY: 1
        }),
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : 1,
        transition: isDragging ? 'none' : 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out'
    } : undefined;

    const tileType = () => {
        if (!letter || !letter.letter || letter.letter === " " || letter.letter === "") {
            return TileTypes.BLANK;
        } else {
            return TileTypes.LETTER;
        }
    }

    const letterDisplay = () => {
        if (letter && letter.letter) {
            return letter.letter;
        } else {
            return " ";
        }
    }

    return (
        <div 
            className={`${styles.tile} ${isDragging ? styles.isDragging : ''}`}
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
        >
            <div className={styles.tileInner}>
                <div className={styles.tileLetter}>
                    {letterDisplay()}
                </div>
                <div className={styles.tilePoints}>
                    {tileType() === TileTypes.LETTER && letter && letter.points !== undefined && 
                        <p>{letter.points}</p>
                    }
                </div>
            </div>
        </div>
    )
}

export default Tile;