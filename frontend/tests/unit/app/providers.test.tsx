import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Providers } from '@/app/providers';
import { useAuth } from '@/lib/auth/AuthProvider';

function Status() {
  return <p>{useAuth().status}</p>;
}

describe('app providers', () => {
  it('give every page the query client and the session', async () => {
    render(
      <Providers>
        <Status />
      </Providers>,
    );
    expect(await screen.findByText('anonymous')).toBeInTheDocument();
  });
});
