import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { LibraryPage } from './routes/LibraryPage'
import { UploadPage } from './routes/UploadPage'
import { ComposersPage } from './routes/ComposersPage'
import { FavoritesPage } from './routes/FavoritesPage'
import { PracticingPage } from './routes/PracticingPage'
import { SetlistPage } from './routes/SetlistPage'
import { NotFoundPage } from './routes/NotFoundPage'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LibraryPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="composers" element={<ComposersPage />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="practicing" element={<PracticingPage />} />
        <Route path="setlists/:id" element={<SetlistPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
