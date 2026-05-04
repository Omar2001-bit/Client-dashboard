import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AdminLayout } from "@/components/Layout/AdminLayout";
import { ClientLayout } from "@/components/Layout/ClientLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuthInit } from "@/hooks/useAuth";
import { AdminHomePage } from "@/pages/admin/AdminHomePage";
import { AdminSupportPage } from "@/pages/admin/AdminSupportPage";
import { ClientLogsPage } from "@/pages/admin/ClientLogsPage";
import { AdminSettingsPage } from "@/pages/admin/AdminSettingsPage";
import { AdminDocsPage } from "@/pages/admin/AdminDocsPage";
import { ClientDetailPage } from "@/pages/admin/ClientDetailPage";
import { ClientListPage } from "@/pages/admin/ClientListPage";
import { CreateClientPage } from "@/pages/admin/CreateClientPage";
import { ClientDashboardPage } from "@/pages/dashboard/ClientDashboardPage";
import { ABTestingResultsPage } from "@/pages/dashboard/ABTestingResultsPage";
import { ExperimentDetailPage } from "@/pages/dashboard/ExperimentDetailPage";
import { ExperimentListPage } from "@/pages/dashboard/ExperimentListPage";
import { GA4DataViewPage } from "@/pages/dashboard/GA4DataViewPage";
import { GA4DashboardPage } from "@/pages/dashboard/GA4DashboardPage";
import { GA4ExperimentsPage } from "@/pages/dashboard/GA4ExperimentsPage";
import { BookMeetingPage } from "@/pages/dashboard/BookMeetingPage";
import { ProfilePage } from "@/pages/dashboard/ProfilePage";
import { TimelinePage } from "@/pages/dashboard/TimelinePage";
import { SupportPage } from "@/pages/dashboard/SupportPage";
import { DocsPage } from "@/pages/dashboard/DocsPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { LoginPage } from "@/pages/LoginPage";
import { SetPasswordPage } from "@/pages/SetPasswordPage";

function App() {
  useAuthInit();

  return (
    <QueryClientProvider client={queryClient}>
    <Router>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />

        <Route element={<ProtectedRoute allowedRole="admin" />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminHomePage />} />
            <Route path="clients" element={<ClientListPage />} />
            <Route path="clients/new" element={<CreateClientPage />} />
            <Route path="clients/:clientId" element={<ClientDetailPage />} />
            <Route path="clients/:clientId/preview" element={<ClientDashboardPage preview />} />
            <Route path="logs" element={<ClientLogsPage />} />
            <Route path="support" element={<AdminSupportPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="docs" element={<AdminDocsPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRole="client" />}>
          <Route path="/dashboard" element={<ClientLayout />}>
            <Route index element={<ClientDashboardPage />} />
            <Route path="ab-testing" element={<ABTestingResultsPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="book-meeting" element={<BookMeetingPage />} />
            <Route path="experiments" element={<ExperimentListPage />} />
            <Route path="experiments/:experimentId" element={<ExperimentDetailPage />} />
            <Route path="ga4" element={<GA4DataViewPage />} />
            <Route path="ga4/dashboard" element={<GA4DashboardPage />} />
            <Route path="ga4/experiments" element={<GA4ExperimentsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="docs" element={<DocsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
    </QueryClientProvider>
  );
}

export default App;
