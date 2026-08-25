import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) {
  throw new Error('Web root element is missing');
}

export function ProductEntry(): React.JSX.Element {
  return <App />;
}

createRoot(root).render(
  <StrictMode>
    <ProductEntry />
  </StrictMode>,
);
