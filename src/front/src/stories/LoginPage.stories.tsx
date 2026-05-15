import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/auth/AuthContext';
import LoginPage from '@/pages/LoginPage';

const queryClient = new QueryClient();

const meta: Meta<typeof LoginPage> = {
  title: 'Pages/LoginPage',
  component: LoginPage,
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            user: null,
            isAuthenticated: false,
            isLoading: false,
            login: async () => {},
            register: async () => {},
            logout: () => {},
          }}
        >
          <MemoryRouter initialEntries={['/login']}>
            <Story />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LoginPage>;

export const Default: Story = {};
