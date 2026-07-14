import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@git-for-music/db';
import {
  createSessionCookie,
  verifyPassword,
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
    password: string;
  }>;

  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const response = NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    { status: 200 },
  );

  response.cookies.set(createSessionCookie(user.id));
  await identifyAnalyticsUser(user.id, {
    email: user.email,
    name: user.name,
  });
  await trackAnalyticsEvent('login', {
    userId: user.id,
  });

  return response;
}
