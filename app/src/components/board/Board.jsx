'use client ';

import styles from "./Board.module.scss";
import BoardCell from "./BoardCell";
import CellTypes from "@/types/CellTypes";

const Board = ({size, bonusTilePositions, placedTiles = {}, isDragging = false}) => {
    const getCellType = (rowIndex, columnIndex) => {
        for (const [position, coordinates] of Object.entries(bonusTilePositions)) {
            if (coordinates[0] === rowIndex && coordinates[1] === columnIndex) {
                switch(position) {
                    case 'DOUBLE_LETTER':
                        return CellTypes.DOUBLE_LETTER;
                    case 'TRIPLE_LETTER':
                        return CellTypes.TRIPLE_LETTER; 
                    case 'DOUBLE_WORD':
                        return CellTypes.DOUBLE_WORD;
                    case 'TRIPLE_WORD':
                        return CellTypes.TRIPLE_WORD;
                }
            }
        }
        return CellTypes.BLANK;
    }

    return (
        <div className={styles.board}>
            {Array.from({length: size}).map((_, rowIndex) => (
                <div key={rowIndex} className={styles.boardRow}>
                    {Array.from({length: size}).map((_, columnIndex) => {
                        const position = { row: rowIndex, col: columnIndex };
                        const cellId = `cell-${rowIndex}-${columnIndex}`;
                        const cellKey = `${rowIndex}-${columnIndex}`;
                        const placedTile = placedTiles[cellKey];
                        
                        // All empty cells are valid targets now
                        const isValidTarget = !placedTile;
                        
                        return (
                            <BoardCell 
                                key={columnIndex} 
                                id={cellId}
                                type={getCellType(rowIndex, columnIndex)} 
                                position={position}
                                placedTile={placedTile}
                                isValidTarget={isValidTarget}
                                isDragging={isDragging}
                            />
                        );
                    })}
                </div>
            ))}
        </div>
    )

}

export default Board;