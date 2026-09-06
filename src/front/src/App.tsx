import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { AuthProvider } from '@/auth/AuthContext';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const DummyPage = lazy(() => import('@/pages/DummyPage'));
const NewWorkflowPage = lazy(() => import('@/pages/NewWorkflowPage'));
const WorkflowCanvasPage = lazy(() => import('@/pages/WorkflowCanvasPage'));
const ExecutionsListPage = lazy(() => import('@/pages/ExecutionsListPage'));
const ExecutionPage = lazy(() => import('@/pages/ExecutionPage'));

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">Loading…</p>
              </div>
            }
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/dummy" element={<DummyPage />} />
              <Route path="/workflows/new" element={<NewWorkflowPage />} />
              <Route path="/workflows/:id" element={<WorkflowCanvasPage />} />
              <Route path="/executions" element={<ExecutionsListPage />} />
              <Route path="/executions/:id" element={<ExecutionPage />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
