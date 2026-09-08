import { Routes, Route } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getConfig, type AppConfig } from './api/config'
import { getMe } from './api/auth'
import { ApiError } from './api/client'
import { AuthContext } from './lib/AuthContext'
import { FirstLaunchFlow } from './routes/FirstLaunchFlow'
import { LoginScreen } from './routes/LoginScreen'
import { SettingsPage } from './routes/SettingsPage'
import { AdminPage } from './routes/AdminPage'
import { AppShell } from './components/AppShell'
import { LibraryPage } from './routes/LibraryPage'
import { BooksPage } from './routes/BooksPage'
import { UploadPage } from './routes/UploadPage'
import { PiecePage } from './routes/PiecePage'
import { BookDetailsPage } from './routes/BookDetailsPage'
import { MockupIndexPage } from './routes/MockupIndexPage'
import { PieceDetailsSample } from './routes/PieceDetailsSample'
import { EditPieceModalMockup } from './routes/EditPieceModalMockup'
import { PieceLibrarySample } from './routes/PieceLibrarySample'
import { BooksLibrarySample } from './routes/BooksLibrarySample'
import { PeopleLibrarySample } from './routes/PeopleLibrarySample'
import { PersonDetailsSample } from './routes/PersonDetailsSample'
import { EditPersonModalMockup } from './routes/EditPersonModalMockup'
import { BookDetailsSample } from './routes/BookDetailsSample'
import { EditBookModalMockup } from './routes/EditBookModalMockup'
import { UploadPieceAboutMockup } from './routes/UploadPieceAboutMockup'
import { UploadBookAboutMockup } from './routes/UploadBookAboutMockup'
import { UploadBookSplitMockup } from './routes/UploadBookSplitMockup'
import { UploadBookTitlesMockup } from './routes/UploadBookTitlesMockup'
import { UploadBookConfirmMockup } from './routes/UploadBookConfirmMockup'
import { MobileNavDrawerMockup } from './routes/MobileNavDrawerMockup'
import { SidebarUserMenuMockup } from './routes/SidebarUserMenuMockup'
import { UserSettingsMockup } from './routes/UserSettingsMockup'
import { AdminSettingsMockup } from './routes/AdminSettingsMockup'
import { AuthChangeFlowMockup } from './routes/AuthChangeFlowMockup'
import { CitationLogicMockup } from './routes/CitationLogicMockup'
import { DeviceInfoMockup } from './routes/DeviceInfoMockup'
import { FirstLaunchMockup } from './routes/FirstLaunchMockup'
import { PeopleLibraryPage } from './routes/PeopleLibraryPage'
import { PersonDetailsPage } from './routes/PersonDetailsPage'
import { FavoritesPage } from './routes/FavoritesPage'
import { WantToLearnPage } from './routes/WantToLearnPage'
import { PracticingPage } from './routes/PracticingPage'
import { LearnedPage } from './routes/LearnedPage'
import { SetlistPage } from './routes/SetlistPage'
import { NotFoundPage } from './routes/NotFoundPage'

function App() {
  // First-time launch flow (multi-user support, memory
  // project_multiuser_build.md's Phase 3) — gates the entire app behind
  // setup completion, not just a route, since nothing else is meant to be
  // reachable until it's done. Same ['config'] query key FirstLaunchFlow
  // itself invalidates on a successful Finish Setup, so completing it
  // swaps this component out automatically once the refetch lands.
  //
  // Fails open on a loading/error config (renders AuthGate either way) —
  // this gate is a first-run UX nicety, not a security boundary. Real
  // login-wall enforcement is AuthGate's job, right below.
  const { data: config, isLoading } = useQuery({ queryKey: ['config'], queryFn: getConfig })

  if (isLoading) {
    return <div className="min-h-dvh bg-paper" />
  }

  if (config && !config.firstLaunchCompleted) {
    return <FirstLaunchFlow config={config} />
  }

  return <AuthGate authMethod={config?.authMethod ?? 'none'} />
}

// AuthGate — multi-user support, master plan Phase 11 (memory
// project_multiuser_build.md). The real login-wall counterpart to
// FirstLaunchFlow's own gate above, reached only once first-launch is
// already done. Resolves GET /api/auth/me before rendering anything real:
// `none` mode always resolves (authMiddleware's implicit id=1 user, no
// session needed), so this never shows LoginScreen there; `singlepass`/
// `oidc` get a genuine 401 straight from authMiddleware when there's no
// valid session cookie, which is what actually triggers it. A successful
// resolution is threaded down via AuthContext rather than re-fetched by
// each consumer — Sidebar/MobileNav's user menu (UserMenuButton) and the
// Admin route guard below both read it from there via useAuth().
function AuthGate({ authMethod }: { authMethod: AppConfig['authMethod'] }) {
  const meQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: false })

  if (meQuery.isLoading) {
    return <div className="min-h-dvh bg-paper" />
  }

  if (meQuery.isError) {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      return <LoginScreen authMethod={authMethod} />
    }
    // A non-401 failure (network error, 500) isn't a "please log in" case —
    // the rest of the app depends on this same backend anyway, so there's
    // nothing useful to render behind it.
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-paper p-6 text-center">
        <p className="text-ink-soft">Couldn't reach the server. Try refreshing.</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={meQuery.data ?? null}>
      <AppRoutes />
    </AuthContext.Provider>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LibraryPage />} />
        <Route path="books" element={<BooksPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="pieces/:id" element={<PiecePage />} />
        <Route path="books/:id" element={<BookDetailsPage />} />
        <Route path="people" element={<PeopleLibraryPage />} />
        <Route path="people/:id" element={<PersonDetailsPage />} />
        {/* Real routes (shell scope) for the sidebar user menu's Settings/
            Admin links — master plan Phase 11. Both stubbed with
            ComingSoon for now; filled in for real against the already-
            approved /mockup/user-settings and /mockup/admin-settings
            designs in Phases 12/13. */}
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        {/* Design mockups and reference samples — unlinked from the main
            nav, browsable via the /mockup index below. Kept intentionally
            for future reference/experimentation, not deleted once whatever
            they were mocking is locked in and built for real. */}
        <Route path="mockup" element={<MockupIndexPage />} />
        <Route path="mockup/piece-details" element={<PieceDetailsSample />} />
        <Route path="mockup/edit-piece-modal" element={<EditPieceModalMockup />} />
        <Route path="mockup/piece-library" element={<PieceLibrarySample />} />
        <Route path="mockup/books-library" element={<BooksLibrarySample />} />
        <Route path="mockup/people-library" element={<PeopleLibrarySample />} />
        <Route path="mockup/person-details" element={<PersonDetailsSample />} />
        <Route path="mockup/edit-person-modal" element={<EditPersonModalMockup />} />
        <Route path="mockup/book-details" element={<BookDetailsSample />} />
        <Route path="mockup/edit-book-modal" element={<EditBookModalMockup />} />
        <Route path="mockup/upload-piece-about" element={<UploadPieceAboutMockup />} />
        <Route path="mockup/upload-book-about" element={<UploadBookAboutMockup />} />
        <Route path="mockup/upload-book-split" element={<UploadBookSplitMockup />} />
        <Route path="mockup/upload-book-titles" element={<UploadBookTitlesMockup />} />
        <Route path="mockup/upload-book-confirm" element={<UploadBookConfirmMockup />} />
        <Route path="mockup/citation-logic" element={<CitationLogicMockup />} />
        <Route path="mockup/device-info" element={<DeviceInfoMockup />} />
        <Route path="mockup/user-settings" element={<UserSettingsMockup />} />
        <Route path="mockup/admin-settings" element={<AdminSettingsMockup />} />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="want-to-learn" element={<WantToLearnPage />} />
        <Route path="practicing" element={<PracticingPage />} />
        <Route path="learned" element={<LearnedPage />} />
        <Route path="setlists/:id" element={<SetlistPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      {/* Not nested inside <AppShell /> — this mockup replaces AppShell's
          own mobile chrome (the sidebar rail), so nesting it inside the
          real AppShell would show the old rail wrapped around it. It
          renders the real <Sidebar /> itself for desktop, so nothing about
          desktop rendering is duplicated or at risk of drifting. */}
      <Route path="mockup/mobile-nav-drawer" element={<MobileNavDrawerMockup />} />
      {/* Also not nested inside <AppShell /> — the real first-launch flow
          is a full-page takeover shown before there's any sidebar/nav to
          speak of (no library confirmed yet, no auth resolved yet), so the
          mockup needs to be reachable without AppShell's sidebar wrapped
          around it, same reasoning as mobile-nav-drawer above. */}
      <Route path="mockup/first-launch" element={<FirstLaunchMockup />} />
      {/* Not nested inside <AppShell /> either — replaces AppShell's own
          sidebar footer (both the desktop rail and MobileNavDrawer), so
          nesting it inside the real shell would show a second, competing
          footer alongside this one's. */}
      <Route path="mockup/sidebar-user-menu" element={<SidebarUserMenuMockup />} />
      {/* Also not nested inside <AppShell /> — a full-page boot-time gate,
          same reasoning as first-launch above (reached before the real app
          — sidebar included — is ever shown). */}
      <Route path="mockup/auth-change-flow" element={<AuthChangeFlowMockup />} />
    </Routes>
  )
}

export default App
