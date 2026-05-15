import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/auth/AuthContext';
import RegisterPage from '@/pages/RegisterPage';

const queryClient = new QueryClient();

const meta: Meta<typeof RegisterPage> = {
  title: 'Pages/RegisterPage',
  component: RegisterPage,
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
          <MemoryRouter initialEntries={['/register']}>
            <Story />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RegisterPage>;

export const Default: Story = {};
