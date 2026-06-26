import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign THREE.Clock deprecation warning from @react-three/fiber
const originalWarn = console.warn;
console.warn = (...args) => {
  if (args[0]?.includes && args[0].includes('THREE.Clock: This module has been deprecated')) return;
  originalWarn(...args);
};

window.addEventListener('error', (e) => {
  alert('Global error: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
});

window.addEventListener('unhandledrejection', (e) => {
  alert('Unhandled Promise Rejection: ' + (e.reason?.message || e.reason || 'Unknown error'));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
