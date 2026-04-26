'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

type GroupMemberListItem = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  userId: string;
  name: string | null;
  email: string;
};

type GroupPageClientProps = {
  groupName: string;
  groupSlug: string;
  members: GroupMemberListItem[];
  canInviteMembers: boolean;
};

export function GroupPageClient({ groupName, groupSlug, members, canInviteMembers }: GroupPageClientProps) {
  const [memberList, setMemberList] = useState(members);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [removingMemberUserId, setRemovingMemberUserId] = useState<string | null>(null);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);

  function closeInviteModal() {
    setIsInviteModalOpen(false);
    setInviteQuery('');
    setInviteError(null);
    setInviteSuccess(null);
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setIsSubmittingInvite(true);

    try {
      const response = await fetch(`/api/groups/${groupSlug}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: inviteQuery }),
      });

      const data = (await response.json()) as { error?: string; invitedUser?: { name: string | null; email: string } };

      if (!response.ok) {
        setInviteError(data.error ?? 'Could not send invite');
        return;
      }

      closeInviteModal();
    } catch {
      setInviteError('Something went wrong. Please try again.');
    } finally {
      setIsSubmittingInvite(false);
    }
  }

  async function removeMember(member: GroupMemberListItem) {
    const memberLabel = member.name?.trim() || member.email;
    const confirmed = window.confirm(`Are you sure you want to remove ${memberLabel} from this group?`);
    if (!confirmed) {
      return;
    }

    setMembersError(null);
    setRemovingMemberUserId(member.userId);

    try {
      const response = await fetch(`/api/groups/${groupSlug}/members/${member.userId}`, {
        method: 'DELETE',
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMembersError(data.error ?? 'Could not remove member');
        return;
      }

      setMemberList((prev) => prev.filter((currentMember) => currentMember.userId !== member.userId));
    } catch {
      setMembersError('Something went wrong. Please try again.');
    } finally {
      setRemovingMemberUserId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">{groupName}</h1>
        <button
          type="button"
          onClick={() => setIsMembersOpen(true)}
          className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Members
        </button>
      </div>

      {isMembersOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close members sidebar"
            onClick={() => setIsMembersOpen(false)}
            className="absolute inset-0 bg-black/55"
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-gray-800 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Members</h2>
              <button
                type="button"
                onClick={() => setIsMembersOpen(false)}
                className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {membersError ? <p className="mb-2 text-sm text-red-400">{membersError}</p> : null}
              <ul className="space-y-2">
                {memberList.map((member) => (
                  <li
                    key={member.id}
                    className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2"
                  >
                    <p className="text-sm font-medium text-white">
                      {member.name?.trim() || member.email}
                    </p>
                    {member.name ? <p className="text-xs text-gray-400">{member.email}</p> : null}
                    <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">{member.role}</p>
                    {canInviteMembers && member.role !== 'OWNER' ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(member)}
                        disabled={removingMemberUserId === member.userId}
                        className="mt-2 rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-60"
                      >
                        {removingMemberUserId === member.userId ? 'Removing...' : 'Remove member'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {canInviteMembers ? (
              <div className="border-t border-gray-800 px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsMembersOpen(false);
                    setIsInviteModalOpen(true);
                  }}
                  className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Add members
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      {isInviteModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
          <button
            type="button"
            aria-label="Close invite modal"
            onClick={closeInviteModal}
            className="absolute inset-0 bg-black/60"
          />

          <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-800 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Add member</h2>
            <p className="mt-1 text-sm text-gray-400">
              Enter a user&apos;s name or email to send them an invitation.
            </p>

            <form className="mt-5 space-y-4" onSubmit={submitInvite}>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Name or email</span>
                <input
                  type="text"
                  required
                  value={inviteQuery}
                  onChange={(event) => setInviteQuery(event.currentTarget.value)}
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring"
                  placeholder="alex@example.com"
                />
              </label>

              {inviteError ? <p className="text-sm text-red-400">{inviteError}</p> : null}
              {inviteSuccess ? <p className="text-sm text-emerald-400">{inviteSuccess}</p> : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeInviteModal}
                  className="rounded-md border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingInvite}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isSubmittingInvite ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
