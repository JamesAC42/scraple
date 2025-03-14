'use client';

import styles from "./InfoPopup.module.scss";
import { FaGithub } from "react-icons/fa";
import { MdEmail } from "react-icons/md";
import { FaXTwitter } from "react-icons/fa6";

const InfoPopup = ({ onClose }) => {
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
        </div>
    );
}

export default InfoPopup;