import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('PowerBoard: #root element is missing');

createRoot(rootEl).render(<h1>PowerBoard</h1>);
