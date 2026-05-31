import { prisma } from '@git-for-music/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiError } from '@git-for-music/shared';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/current-user';
import {
  listProjectPresence,
  removeProjectPresence,
  upsertProjectPresence,
} from '@/features/daw/server/presence-service';

function parseDemoId(req: NextRequest) {
  return req.nextUrl.searchParams.get('demoId');
}

async function resolvePresenceAccess(
  req: NextRequest,
  params: { projectId: string },
) {
  const user = await getAuthenticatedUserFromRequest(req);
  if (!user) {
    return { error: NextResponse.json<ApiError>({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const demoId = parseDemoId(req);
  if (!demoId) {
    return { error: NextResponse.json<ApiError>({ error: 'demoId is required' }, { status: 400 }) };
  }

  const demo = await prisma.demo.findFirst({
    where: {
      id: demoId,
      projectId: params.projectId,
      project: {
        group: {
          members: {
            some: {
              userId: user.id,
            },
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!demo) {
    return { error: NextResponse.json<ApiError>({ error: 'Project not found' }, { status: 404 }) };
  }

  return { user, demoId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const access = await resolvePresenceAccess(req, { projectId });
  if ('error' in access) return access.error;

  const presences = listProjectPresence({ projectId, demoId: access.demoId });
  return NextResponse.json({ presences });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const access = await resolvePresenceAccess(req, { projectId });
  if ('error' in access) return access.error;

  const body = (await req.json()) as Partial<{
    presenceId: string;
    status: 'online' | 'idle' | 'away';
    cursorTimeMs: number | null;
    selectedTrackId: string | null;
    currentTool: 'select' | 'split' | 'merge' | 'fade' | 'crossfade';
    recordingState: 'idle' | 'recording' | 'preview' | 'uploading' | 'error';
    playbackFollowState: boolean;
  }>;

  if (!body.presenceId || typeof body.presenceId !== 'string') {
    return NextResponse.json<ApiError>({ error: 'presenceId is required' }, { status: 400 });
  }

  if (body.status !== 'online' && body.status !== 'idle' && body.status !== 'away') {
    return NextResponse.json<ApiError>({ error: 'status is required' }, { status: 400 });
  }

  if (
    body.currentTool !== 'select' &&
    body.currentTool !== 'split' &&
    body.currentTool !== 'merge' &&
    body.currentTool !== 'fade' &&
    body.currentTool !== 'crossfade'
  ) {
    return NextResponse.json<ApiError>({ error: 'currentTool is required' }, { status: 400 });
  }

  if (
    body.recordingState !== 'idle' &&
    body.recordingState !== 'recording' &&
    body.recordingState !== 'preview' &&
    body.recordingState !== 'uploading' &&
    body.recordingState !== 'error'
  ) {
    return NextResponse.json<ApiError>({ error: 'recordingState is required' }, { status: 400 });
  }

  const cursorTimeMs =
    body.cursorTimeMs === null ||
    (typeof body.cursorTimeMs === 'number' && Number.isFinite(body.cursorTimeMs) && body.cursorTimeMs >= 0)
      ? body.cursorTimeMs ?? null
      : null;

  const selectedTrackId =
    typeof body.selectedTrackId === 'string' && body.selectedTrackId.trim()
      ? body.selectedTrackId.trim()
      : null;

  const playbackFollowState = typeof body.playbackFollowState === 'boolean' ? body.playbackFollowState : false;

  const presence = upsertProjectPresence({
    projectId,
    demoId: access.demoId,
    actorUserId: access.user.id,
    presenceId: body.presenceId,
    status: body.status,
    cursorTimeMs,
    selectedTrackId,
    currentTool: body.currentTool,
    recordingState: body.recordingState,
    playbackFollowState,
  });

  return NextResponse.json({ presence });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const access = await resolvePresenceAccess(req, { projectId });
  if ('error' in access) return access.error;

  const presenceId = req.nextUrl.searchParams.get('presenceId');
  if (!presenceId) {
    return NextResponse.json<ApiError>({ error: 'presenceId is required' }, { status: 400 });
  }

  removeProjectPresence({
    projectId,
    demoId: access.demoId,
    presenceId,
  });

  return NextResponse.json({ ok: true });
}
