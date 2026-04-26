'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password, confirmPassword }),
      });

      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !data.id) {
        setError(data.error ?? 'Could not create account');
        return;
      }

      router.push('/login');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-2xl font-bold">Create an account</h1>
        <p className="mb-6 text-sm text-gray-400">Enter your details to create your git-for-music account.</p>

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
            <span className="mb-1 block text-sm text-gray-300">Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
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

          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Confirm password</span>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
