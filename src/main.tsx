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

function showCustomAlert(msg: string) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
  overlay.style.backdropFilter = 'blur(4px)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '999999';

  const popup = document.createElement('div');
  popup.style.backgroundColor = '#18181b';
  popup.style.border = '1px solid #27272a';
  popup.style.borderRadius = '12px';
  popup.style.padding = '24px';
  popup.style.maxWidth = '400px';
  popup.style.width = '90%';
  popup.style.color = '#e4e4e7';
  popup.style.boxShadow = '0 20px 25px -5px rgba(0,0,0,0.5)';
  popup.style.fontFamily = 'system-ui, -apple-system, sans-serif';

  const title = document.createElement('h3');
  title.textContent = 'LUCY says';
  title.style.margin = '0 0 12px 0';
  title.style.color = '#38bdf8';
  title.style.fontSize = '18px';
  title.style.fontWeight = '600';

  const body = document.createElement('p');
  body.textContent = msg;
  body.style.margin = '0 0 24px 0';
  body.style.lineHeight = '1.5';
  body.style.fontSize = '14px';
  body.style.wordBreak = 'break-word';

  const btnContainer = document.createElement('div');
  btnContainer.style.display = 'flex';
  btnContainer.style.justifyContent = 'flex-end';

  const btn = document.createElement('button');
  btn.textContent = 'OK';
  btn.style.padding = '8px 24px';
  btn.style.backgroundColor = '#0ea5e9';
  btn.style.color = '#ffffff';
  btn.style.border = 'none';
  btn.style.borderRadius = '6px';
  btn.style.cursor = 'pointer';
  btn.style.fontWeight = '500';
  btn.style.fontSize = '14px';
  btn.style.transition = 'background-color 0.2s';
  
  btn.onmouseover = () => btn.style.backgroundColor = '#0284c7';
  btn.onmouseout = () => btn.style.backgroundColor = '#0ea5e9';
  btn.onclick = () => document.body.removeChild(overlay);

  btnContainer.appendChild(btn);
  popup.appendChild(title);
  popup.appendChild(body);
  popup.appendChild(btnContainer);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

window.addEventListener('error', (e) => {
  showCustomAlert('Global error: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
});

window.addEventListener('unhandledrejection', (e) => {
  showCustomAlert('Unhandled Promise Rejection: ' + (e.reason?.message || e.reason || 'Unknown error'));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
