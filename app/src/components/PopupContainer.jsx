'use client';

import { usePopup } from "../contexts/PopupContext";
import styles from "./PopupContainer.module.scss";

import InfoPopup from "./popups/InfoPopup";
import HelpPopup from "./popups/HelpPopup";

import { IoMdClose } from "react-icons/io";

const PopupContainer = () => {

    const { activePopup, setActivePopup } = usePopup();

    const handleClosePopup = () => {
        setActivePopup(null);
    }

    const renderPopupTitle = () => {
        switch (activePopup) {
            case 'info':
                return "About";
            case 'help':
                return "How To Play";
        }
    }

    const renderPopupContent = () => {
        switch (activePopup) {
            case 'info':
                return <InfoPopup onClose={handleClosePopup}/>;
            case 'help':
                return <HelpPopup onClose={handleClosePopup}/>;
            default:
                return null;
        }
    }

    if (!activePopup) return null;

    return (
        <div className={styles.popupOuter}>
            <div className={styles.popupInner}>
                <div 
                    className={styles.popupBackground}
                    onClick={handleClosePopup}
                ></div>
                <div className={styles.popupContent}>
                    <div className={styles.popupHeader}>
                        <h2>{renderPopupTitle()}</h2>
                        <div className={styles.popupCloseButton} onClick={handleClosePopup}>
                            <IoMdClose />
                        </div>
                    </div>
                    {renderPopupContent()}
                </div>
            </div>
        </div>
    );
}

export default PopupContainer;