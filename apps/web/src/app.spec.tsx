// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './app.js';

describe('App', () => {
  it('renders the engineering baseline boundary', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '工程基线已就绪' })).toBeTruthy();
    expect(screen.getByText(/不包含任何访谈业务功能/)).toBeTruthy();
  });
});
