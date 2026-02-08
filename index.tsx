
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Shim process for browser environment to support process.env.API_KEY injected by hosting
if (typeof window !== 'undefined' && typeof (window as any).process === 'undefined') {
  (window as any).process = { 
    env: {
      API_KEY: (window as any)._env_?.API_KEY || ''
    } 
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
