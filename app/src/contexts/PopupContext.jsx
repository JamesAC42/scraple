'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const PopupContext = createContext();

export const usePopup = () => useContext(PopupContext);

export const PopupProvider = ({ children }) => {

  const [activePopup, setActivePopup] = useState(null);

  return (
    <PopupContext.Provider value={{ activePopup, setActivePopup }}>
      {children}
    </PopupContext.Provider>
  );
};

export default PopupProvider; 