import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AccountPageClient from './account-page-client';

describe('AccountPageClient', () => {
  it('shows a plugin library button that links to the plugins page', () => {
    render(<AccountPageClient userName="Ada" userEmail="ada@example.com" />);

    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();

    const link = screen.getByRole('link', { name: 'Plugin Library' });
    expect(link.getAttribute('href')).toBe('/account/plugins');
  });
});
