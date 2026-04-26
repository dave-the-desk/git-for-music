export default async function DemoPage({
  params,
}: {
  params: Promise<{ groupId: string; projectId: string; demoId: string }>;
}) {
  const { groupId, projectId, demoId } = await params;

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Demo Page</h1>
      <p className="text-sm text-gray-400">
        Group: {groupId} | Project: {projectId} | Demo: {demoId}
      </p>
    </div>
  );
}
