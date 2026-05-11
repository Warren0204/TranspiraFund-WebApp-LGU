import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext({ isDark: false, toggle: () => {} });

export const ThemeProvider = ({ children }) => {
    const [isDark, setIsDark] = useState(() => {
        try {
            const val = localStorage.getItem('hcsd-theme') ?? localStorage.getItem('depw-theme');
            if (val === 'dark') return true;
            if (val === 'light') return false;
            return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
        }
        catch { return false; }
    });

    useEffect(() => {
        const root = document.documentElement;
        if (isDark) {
            root.classList.add('dark');
            localStorage.setItem('hcsd-theme', 'dark');
        } else {
            root.classList.remove('dark');
            localStorage.setItem('hcsd-theme', 'light');
        }
    }, [isDark]);

    return (
        <ThemeContext.Provider value={{ isDark, toggle: () => setIsDark(d => !d) }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
