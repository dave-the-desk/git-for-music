import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@git-for-music/db';
import {
  createSessionCookie,
  hashPassword,
} from '@git-for-music/server/app/lib/auth';
import {
  identifyAnalyticsUser,
  trackAnalyticsEvent,
} from '@git-for-music/server/app/lib/extensions';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<{
    email: string;
    name: string;
    password: string;
    confirmPassword: string;
  }>;

  const email = body.email?.trim().toLowerCase() ?? '';
  const name = body.name?.trim() ?? '';
  const password = body.password ?? '';
  const confirmPassword = body.confirmPassword ?? '';

  if (!email || !name || !password || !confirmPassword) {
    return NextResponse.json({ error: 'email, name, password, and confirmPassword are required' }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return NextResponse.json({ error: 'Password and confirm password must match' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: 'An account with that email already exists' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });

  const response = NextResponse.json(user, { status: 201 });

  response.cookies.set(createSessionCookie(user.id));
  await identifyAnalyticsUser(user.id, {
    email: user.email,
    name: user.name,
  });
  await trackAnalyticsEvent('signup', {
    userId: user.id,
  });

  return response;
}
