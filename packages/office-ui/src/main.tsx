import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// The window is for watching only: no context menu, no text selection, no drag of the picture.
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(<App />);
