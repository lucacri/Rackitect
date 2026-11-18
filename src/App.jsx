import { AppProvider } from './state/AppContext'
import { DragProvider, ModalProvider, ToastProvider } from './state/UIContext'
import Toolbar       from './components/Toolbar'
import LibraryPanel  from './components/LibraryPanel'
import RackCanvas    from './components/RackCanvas'
import PropertiesPanel from './components/PropertiesPanel'
import DeviceModal   from './components/DeviceModal'
import ConfirmModal  from './components/ConfirmModal'
import PrintSheet    from './components/PrintSheet'

export default function App() {
  return (
    <AppProvider>
      <DragProvider>
        <ModalProvider>
          <ToastProvider>
            <div className="app-shell">
              <Toolbar />
              <div className="app-body">
                <LibraryPanel />
                <RackCanvas />
                <PropertiesPanel />
              </div>
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
