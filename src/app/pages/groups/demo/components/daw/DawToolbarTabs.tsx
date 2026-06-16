'use client';

export type DawToolbarTab = 'edit' | 'upload' | 'plugins' | 'tree' | 'comments' | 'members';

type DawToolbarTabsProps = {
  activeTab: DawToolbarTab;
  onTabChange: (tab: DawToolbarTab) => void;
};

const tabs: Array<{ id: DawToolbarTab; label: string }> = [
  { id: 'edit', label: 'Edit' },
  { id: 'upload', label: 'Upload' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'tree', label: 'Tree' },
  { id: 'comments', label: 'Comments' },
  { id: 'members', label: 'Members' },
];

export function DawToolbarTabs({ activeTab, onTabChange }: DawToolbarTabsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-700 bg-slate-950 px-3 pt-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`rounded-t-md border px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-slate-600 border-b-slate-950 bg-slate-950 text-white'
                : 'border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
            aria-pressed={isActive}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
