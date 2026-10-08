import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdateBanner } from './components/UpdateBanner';
import { migrate, requestPersistence } from './lib/storage';
import './styles.css';

migrate();
requestPersistence();

createRoot(document.getElementById('root')!).render(<StrictMode><App /><UpdateBanner /></StrictMode>);
