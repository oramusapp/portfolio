import type { ReactNode } from 'react';
import { IcClose } from './icons';

export type CornerTab = 'networth' | 'notes';

/** Window behind the bottom-right button: Net worth and Notes tabs. Both stay mounted so unsaved input survives a tab switch. */
export function CornerPanel({ tab, setTab, onClose, networth, notes }: { tab: CornerTab; setTab: (t: CornerTab) => void; onClose: () => void; networth: ReactNode; notes: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`modal narrow corner-modal ${tab}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="seg tabs">
            <button className={tab === 'networth' ? 'on' : ''} onClick={() => setTab('networth')}>Net worth</button>
            <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes</button>
          </div>
          <button className="icon" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>
        <div style={{ display: tab === 'networth' ? 'contents' : 'none' }}>{networth}</div>
        <div style={{ display: tab === 'notes' ? 'contents' : 'none' }}>{notes}</div>
      </div>
    </div>
  );
}
