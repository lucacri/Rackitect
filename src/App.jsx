import { useEffect, useState } from 'react'
import { AppProvider, useApp } from './state/AppContext'
import { DragProvider, ModalProvider, ToastProvider } from './state/UIContext'
import Toolbar       from './components/Toolbar'
import LibraryPanel  from './components/LibraryPanel'
import RackCanvas    from './components/RackCanvas'
import PropertiesPanel from './components/PropertiesPanel'
import DeviceModal   from './components/DeviceModal'
import ConfirmModal  from './components/ConfirmModal'
import PrintSheet    from './components/PrintSheet'

const TABS = [['rack', 'Rack'], ['library', 'Library'], ['details', 'Details']]

// On phones only one panel shows at a time (see .phone-tabs in App.css); desktop ignores data-tab
function AppBody() {
  const { state } = useApp()
  const [tab, setTab] = useState('rack')
  // Tapping a device on the rack opens its details
  useEffect(() => { if (state.selId) setTab('details') }, [state.selId])

  return (
    <>
      <nav className="phone-tabs" aria-label="Panels">
        {TABS.map(([key, label]) => (
          <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="app-body" data-tab={tab}>
        <LibraryPanel />
        <RackCanvas />
        <PropertiesPanel />
      </div>
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <DragProvider>
        <ModalProvider>
          <ToastProvider>
            <div className="app-shell">
              <Toolbar />
              <AppBody />
              <footer className="app-footer">
                <span>Built with love ❤️ by Lucacri</span>
              </footer>
            </div>
            <DeviceModal />
            <ConfirmModal />
            <PrintSheet />
          </ToastProvider>
        </ModalProvider>
      </DragProvider>
    </AppProvider>
  )
}
