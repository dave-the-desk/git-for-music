import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppLayout from './app-layout';

const mockPathname = vi.hoisted(() => ({
  value: '/groups/demo-group',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.value,
}));

vi.mock('./components/NotificationBell', () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));

describe('AppLayout header links', () => {
  it('shows the account link to the right of notifications', () => {
    render(createElement(AppLayout, null, <div>Content</div>));

    const notificationsButton = screen.getByRole('button', { name: 'Notifications' });
    const accountLink = screen.getByRole('link', { name: 'Account' });

    expect(accountLink).toBeTruthy();
    expect(notificationsButton.compareDocumentPosition(accountLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accountLink.getAttribute('href')).toBe('/account');
  });
});
