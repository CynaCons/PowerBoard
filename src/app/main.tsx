import { createRoot } from 'react-dom/client';
import { App } from './App';
import { emptyFile, readEmbedded } from './fileFormat';
import { useAppStore } from './store';

/**
 * Startup load order: the data embedded in this HTML file (opened from disk),
 * else a brand-new file with one empty board (REQ-PB-111).
 */
useAppStore.getState().setFile(readEmbedded(document) ?? emptyFile());

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('PowerBoard: #root element is missing');

createRoot(rootEl).render(<App />);
