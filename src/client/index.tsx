import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

// Locally bundle KaTeX and Highlight.js CSS so no external network requests are needed
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark-dimmed.css';

import './styles/index.css';
import './styles/components.css';
import './styles/markdown.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element to mount application');
}

// Mark React mounting starting
if (typeof window !== 'undefined') {
  (window as any).__REACT_MOUNTED__ = true;
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
