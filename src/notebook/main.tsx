import { reportNotebookVisibility } from '../browser/surfaceVisibility';
import { extension, isExtensionContext } from '../browser/api';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../styles/notebook.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (
  isExtensionContext() &&
  extension.runtime.getManifest().action?.default_popup &&
  !location.search
)
  document.documentElement.classList.add('notebook-popup');

reportNotebookVisibility();
