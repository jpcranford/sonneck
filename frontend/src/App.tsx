import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { LibraryPage } from './routes/LibraryPage'
import { BooksPage } from './routes/BooksPage'
import { UploadPage } from './routes/UploadPage'
import { PiecePage } from './routes/PiecePage'
import { BookDetailsPage } from './routes/BookDetailsPage'
import { MockupIndexPage } from './routes/MockupIndexPage'
import { PieceViewSample } from './routes/PieceViewSample'
import { EditPieceModalMockup } from './routes/EditPieceModalMockup'
import { BooksLibrarySample } from './routes/BooksLibrarySample'
import { BookDetailsSample } from './routes/BookDetailsSample'
import { EditBookModalMockup } from './routes/EditBookModalMockup'
import { UploadBookAboutMockup } from './routes/UploadBookAboutMockup'
import { UploadBookSplitMockup } from './routes/UploadBookSplitMockup'
import { UploadBookTitlesMockup } from './routes/UploadBookTitlesMockup'
import { UploadBookConfirmMockup } from './routes/UploadBookConfirmMockup'
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
        <Route path="books/:id" element={<BookDetailsPage />} />
        {/* Design mockups and reference samples — unlinked from the main
            nav, browsable via the /mockup index below. Kept intentionally
            for future reference/experimentation, not deleted once whatever
            they were mocking is locked in and built for real. */}
        <Route path="mockup" element={<MockupIndexPage />} />
        <Route path="mockup/piece-view" element={<PieceViewSample />} />
        <Route path="mockup/edit-piece-modal" element={<EditPieceModalMockup />} />
        <Route path="mockup/books-library" element={<BooksLibrarySample />} />
        <Route path="mockup/book-details" element={<BookDetailsSample />} />
        <Route path="mockup/edit-book-modal" element={<EditBookModalMockup />} />
        <Route path="mockup/upload-book-about" element={<UploadBookAboutMockup />} />
        <Route path="mockup/upload-book-split" element={<UploadBookSplitMockup />} />
        <Route path="mockup/upload-book-titles" element={<UploadBookTitlesMockup />} />
        <Route path="mockup/upload-book-confirm" element={<UploadBookConfirmMockup />} />
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
