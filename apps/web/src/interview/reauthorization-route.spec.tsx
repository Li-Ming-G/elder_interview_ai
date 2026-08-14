// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReauthorizationRoute } from './reauthorization-route.js';

describe('ReauthorizationRoute', () => {
  afterEach(cleanup);

  it('fails closed without inventing policy text, consent, or recording controls', () => {
    const navigate = vi.fn();
    render(<ReauthorizationRoute navigate={navigate} />);
    expect(screen.getByRole('heading', { name: '当前无法重新登记正式授权' })).toBeTruthy();
    expect(screen.getByText(/不会创建授权记录或授权录音/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /录制|同意|登记/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回工作区' }));
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
