import { createContext, useContext } from 'react';

// { page, param, go(page, param), openScan(code), printTag(kind, id), printCoa(lotId) }
export const NavContext = createContext(null);
export const useNav = () => useContext(NavContext);
