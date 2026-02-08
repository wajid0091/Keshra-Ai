import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Reinforce the process shim for module scope
if (typeof window !== 'undefined') {
  (window as any).process = (window as any).process || { env: {} };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Critical: Root element not found.");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);