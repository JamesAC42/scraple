'use client';

import styles from "./Confirm.module.scss";

const Confirm = ({ message, confirm, cancel }) => {
    return (
        <div className={styles.confirm}>
            <div className={styles.content}>
                <p>{message}</p>
                <div className={styles.buttons}>
                    <button onClick={confirm}>Yes</button>
                    <button onClick={cancel}>No</button>
                </div>
            </div>
        </div>
    );
}

export default Confirm;