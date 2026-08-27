import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, useLocation } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { GovernorateProvider } from './context/GovernorateContext';
import { CartProvider } from './context/CartContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { FollowProvider } from './context/FollowContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from '@rafidain/shared/ui';
import './styles.css';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ScrollToTop />
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <GovernorateProvider>
              <CartProvider>
                <FavoritesProvider>
                  <FollowProvider>
                    <App />
                  </FollowProvider>
                </FavoritesProvider>
              </CartProvider>
            </GovernorateProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </HashRouter>
  </React.StrictMode>
);
