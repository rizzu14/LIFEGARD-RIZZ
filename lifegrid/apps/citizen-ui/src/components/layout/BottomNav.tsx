import React from 'react';
import { motion } from 'framer-motion';
import { Home, MapPin, MessageCircle, FileText, Bell } from 'lucide-react';
import { useAppStore, AppTab } from '../../store/appStore';
import { useHaptic } from '../../hooks/useHaptic';

interface NavItem {
  id: AppTab;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home',   icon: Home,          label: 'Home'   },
  { id: 'track',  icon: MapPin,        label: 'Track'  },
  { id: 'chat',   icon: MessageCircle, label: 'Guide'  },
  { id: 'report', icon: FileText,      label: 'Report' },
  { id: 'alerts', icon: Bell,          label: 'Alerts' },
];

export function BottomNav() {
  const { activeTab, setActiveTab, unreadAlertCount, chatMessages } = useAppStore();
  const { haptic } = useHaptic();

  const unreadChat = chatMessages.filter(m => !m.isRead && m.role !== 'user').length;

  const handleTab = (tab: AppTab) => {
    if (tab === activeTab) return;
    haptic('tap');
    setActiveTab(tab);
  };

  return (
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
        const isActive = activeTab === id;
        const badge = id === 'alerts' ? unreadAlertCount : id === 'chat' ? unreadChat : 0;

        return (
          <button
            key={id}
            className={`nav-item ${isActive ? 'active' : ''}`}
            onClick={() => handleTab(id)}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
          >
            <div className="relative">
              <Icon className="nav-icon" strokeWidth={isActive ? 2 : 1.5} />
              {badge > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center"
                >
                  <span className="text-[8px] font-bold text-white leading-none">
                    {badge > 9 ? '9+' : badge}
                  </span>
                </motion.span>
              )}
            </div>
            <span className="nav-label">{label}</span>

            {isActive && (
              <motion.div
                layoutId="nav-indicator"
                className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gray-900"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
