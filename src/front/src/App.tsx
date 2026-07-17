import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthContext';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import DummyPage from '@/pages/DummyPage';
import NewWorkflowPage from '@/pages/NewWorkflowPage';
import WorkflowCanvasPage from '@/pages/WorkflowCanvasPage';
import ExecutionsListPage from '@/pages/ExecutionsListPage';
import ExecutionPage from '@/pages/ExecutionPage';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
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
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
