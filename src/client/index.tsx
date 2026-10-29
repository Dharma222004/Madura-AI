import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/index.css';
import './styles/components.css';
import './styles/markdown.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element to mount application');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
