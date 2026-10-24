import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SetupPage } from '../../src/features/auth/SetupPage'

describe('SetupPage', () => {
  it('directs operators to configure browser-safe hosted credentials', () => {
    render(<SetupPage />)
    expect(screen.getByRole('heading', { name: /connect the application to supabase/i })).toBeInTheDocument()
    expect(screen.getByText(/needs browser-safe supabase project credentials/i)).toBeInTheDocument()
    expect(screen.getByText(/open the connected supabase project/i)).toBeInTheDocument()
    expect(screen.queryByText(/start the local backend/i)).not.toBeInTheDocument()
  })
})
