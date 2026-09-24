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

// Global Error & Promise Rejection Handlers for WebView2 Visibility
function showCustomAlert(titleText: string, msg: string, stack?: string) {
  // Prevent stacking duplicate or excessive error overlays
  if (document.getElementById('lucy-global-error-overlay')) {
    const existingBody = document.getElementById('lucy-global-error-body');
    if (existingBody) {
      existingBody.textContent = `${existingBody.textContent}\n\n[Additional Error]: ${msg}`;
    }
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'lucy-global-error-overlay';
  overlay.className = 'pointer-events-auto';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
  overlay.style.backdropFilter = 'blur(8px)';
  (overlay.style as any).WebkitBackdropFilter = 'blur(8px)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '999999';

  const popup = document.createElement('div');
  popup.className = 'pointer-events-auto';
  popup.style.backgroundColor = 'rgba(13, 13, 18, 0.95)';
  popup.style.border = '1px solid rgba(236, 72, 153, 0.35)';
  popup.style.borderRadius = '16px';
  popup.style.padding = '24px';
  popup.style.maxWidth = '520px';
  popup.style.width = '90%';
  popup.style.color = '#f4f4f5';
  popup.style.boxShadow = '0 25px 50px -12px rgba(236, 72, 153, 0.25), 0 0 30px rgba(0, 0, 0, 0.8)';
  popup.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';
  popup.style.gap = '12px';

  const title = document.createElement('h3');
  title.textContent = titleText || 'LUCY Runtime Alert';
  title.style.margin = '0';
  title.style.color = '#f472b6';
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.025em';

  const body = document.createElement('div');
  body.id = 'lucy-global-error-body';
  body.textContent = msg;
  body.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
  body.style.border = '1px solid rgba(244, 114, 182, 0.2)';
  body.style.borderRadius = '8px';
  body.style.padding = '12px';
  body.style.lineHeight = '1.5';
  body.style.fontSize = '13px';
  body.style.color = '#fce7f3';
  body.style.fontFamily = 'monospace';
  body.style.wordBreak = 'break-word';
  body.style.maxHeight = '180px';
  body.style.overflowY = 'auto';
  body.style.userSelect = 'text';

  const btnContainer = document.createElement('div');
  btnContainer.style.display = 'flex';
  btnContainer.style.justifyContent = 'flex-end';
  btnContainer.style.gap = '8px';
  btnContainer.style.marginTop = '4px';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Error';
  copyBtn.className = 'pointer-events-auto';
  copyBtn.style.padding = '8px 16px';
  copyBtn.style.backgroundColor = 'rgba(39, 39, 42, 0.8)';
  copyBtn.style.color = '#e4e4e7';
  copyBtn.style.border = '1px solid rgba(63, 63, 70, 0.8)';
  copyBtn.style.borderRadius = '8px';
  copyBtn.style.cursor = 'pointer';
  copyBtn.style.fontWeight = '500';
  copyBtn.style.fontSize = '13px';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(`${titleText}\n\n${msg}${stack ? '\n\n' + stack : ''}`);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy Error'; }, 1500);
  };

  const okBtn = document.createElement('button');
  okBtn.textContent = 'Dismiss';
  okBtn.className = 'pointer-events-auto';
  okBtn.style.padding = '8px 20px';
  okBtn.style.background = 'linear-gradient(to right, #ec4899, #9333ea)';
  okBtn.style.color = '#ffffff';
  okBtn.style.border = 'none';
  okBtn.style.borderRadius = '8px';
  okBtn.style.cursor = 'pointer';
  okBtn.style.fontWeight = '600';
  okBtn.style.fontSize = '13px';
  okBtn.style.transition = 'filter 0.2s';
  okBtn.onmouseover = () => { okBtn.style.filter = 'brightness(1.1)'; };
  okBtn.onmouseout = () => { okBtn.style.filter = 'brightness(1)'; };
  okBtn.onclick = () => {
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
  };

  btnContainer.appendChild(copyBtn);
  btnContainer.appendChild(okBtn);
  popup.appendChild(title);
  popup.appendChild(body);
  popup.appendChild(btnContainer);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

window.addEventListener('error', (e) => {
  // Ignore harmless resize observer loop notifications
  if (e.message?.includes('ResizeObserver loop completed with undelivered notifications') ||
      e.message?.includes('ResizeObserver loop limit exceeded')) {
    return;
  }
  console.error('[WebView2 Global Window Error]', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error,
  });
  const detail = e.error?.stack || `${e.message} (${e.filename}:${e.lineno}:${e.colno})`;
  showCustomAlert('LUCY Global Error', detail, e.error?.stack);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[WebView2 Unhandled Promise Rejection]', e.reason);
  const reason = e.reason;
  const detail = reason?.stack || reason?.message || String(reason || 'Unknown promise rejection');
  showCustomAlert('LUCY Unhandled Rejection', detail, reason?.stack);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
