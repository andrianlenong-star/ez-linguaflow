import {
  BookOpen,
  FileText,
  History,
  Image as ImageIcon,
  Languages,
  ListChecks,
  Mic,
  Settings,
  X,
} from 'lucide-react';
import type { NavView } from '../shared/types.ts';

interface SidebarNavProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  historyCount: number;
  activeGlossaryCount: number;
}

const NAV_ITEMS: Array<{
  id: NavView;
  label: string;
  icon: typeof Languages;
}> = [
  { id: 'translate', label: 'Translate Text', icon: Languages },
  { id: 'documents', label: 'Translate Documents', icon: FileText },
  { id: 'images', label: 'Translate Images', icon: ImageIcon },
  { id: 'voice', label: 'Translate Voice', icon: Mic },
  { id: 'dictionary', label: 'Dictionary', icon: BookOpen },
  { id: 'glossary', label: 'Glossary', icon: ListChecks },
  { id: 'history', label: 'Translation History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function SidebarNav({
  activeView,
  onSelectView,
  mobileOpen,
  onCloseMobile,
  historyCount,
  activeGlossaryCount,
}: SidebarNavProps) {
  const navContent = (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between h-16 px-5 border-b border-slate-200 dark:border-slate-800">
        <a
          href="#translate"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('translate');
            onCloseMobile();
          }}
          className="flex items-center gap-2.5 text-slate-900 dark:text-slate-50 font-bold text-base tracking-tight whitespace-nowrap shrink-0"
        >
          <img
            src="/assets/aistudio/IMG_20261112_191823_cec36c04.png"
            alt="EduZone Linguaflow logo"
            className="w-9 h-9 rounded-xl object-cover shrink-0 shadow-xs border border-slate-200/80 dark:border-slate-700/80"
          />
          <span>EduZone Linguaflow</span>
        </a>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav aria-label="Main navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          const count =
            item.id === 'history'
              ? historyCount
              : item.id === 'glossary'
                ? activeGlossaryCount
                : 0;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[42px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {count > 0 && (
                <span className="text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{navContent}</div>
        </div>
      )}
    </>
  );
}
