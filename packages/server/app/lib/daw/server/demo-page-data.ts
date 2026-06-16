import { loadDemoDawPageDataWithSnapshots } from '@/app/lib/daw/server/snapshot-builder';

export async function getDemoDawPageData({
  groupId,
  projectId,
  demoId,
  userId,
}: {
  groupId: string;
  projectId: string;
  demoId: string;
  userId: string;
}) {
  return loadDemoDawPageDataWithSnapshots({
    groupId,
    projectId,
    demoId,
    userId,
  });
}
