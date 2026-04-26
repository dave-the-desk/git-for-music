'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !data.id) {
        setError(data.error ?? 'Could not log in');
        return;
      }

      router.push('/home');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Log in</h1>
        <p className="mb-6 text-sm text-gray-400">Enter your email and password to access your account.</p>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <p className="mt-6 text-sm text-gray-400">
          Don&apos;t have an account,{' '}
          <Link href="/signup" className="font-medium text-indigo-300 underline hover:text-indigo-200">
            Create one here
          </Link>
        </p>
      </div>
    </div>
  );
}
