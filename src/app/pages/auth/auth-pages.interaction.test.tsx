import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { branding } from '@/app/product/branding';
import LoginPage from './login-page';
import SignupPage from './signup-page';

const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

describe('auth pages branding', () => {
  it('renders the app name in the login page copy', () => {
    render(createElement(LoginPage));

    expect(screen.getByRole('heading', { name: `Log in to ${branding.appName}` })).toBeTruthy();
    expect(
      screen.getByText(`Enter your email and password to access your ${branding.appName} account.`),
    ).toBeTruthy();
  });

  it('renders the app name in the signup page copy', () => {
    render(createElement(SignupPage));

    expect(screen.getByRole('heading', { name: `Create a ${branding.appName} account` })).toBeTruthy();
    expect(
      screen.getByText(`Enter your details to create your ${branding.appName} account.`),
    ).toBeTruthy();
  });
});
