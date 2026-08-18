import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { LibraryPage } from './routes/LibraryPage'
import { BooksPage } from './routes/BooksPage'
import { UploadPage } from './routes/UploadPage'
import { PiecePage } from './routes/PiecePage'
import { PieceViewSample } from './routes/PieceViewSample'
import { EditPieceModalMockup } from './routes/EditPieceModalMockup'
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
        <Route path="books" element={<BooksPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="pieces/:id" element={<PiecePage />} />
        {/* Reference sample, unlinked from nav — a standing design
            reference for the Piece View, kept intentionally (not deleted
            once "locked in" the way earlier mockups were). */}
        <Route path="mockup/piece-view" element={<PieceViewSample />} />
        {/* Design mockup, unlinked from nav — remove once §15 is locked in
            and built for real. */}
        <Route path="mockup/edit-piece-modal" element={<EditPieceModalMockup />} />
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
