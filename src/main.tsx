import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled locally (no requests to a font CDN) and include Cyrillic for Mongolian.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';

import App from './App';
import { I18nProvider } from './i18n';
import { ToastProvider } from './lib/toast';
import { PrefsProvider } from './prefs';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </PrefsProvider>
  </StrictMode>,
);
