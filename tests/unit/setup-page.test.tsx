import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SetupPage } from '../../src/features/auth/SetupPage'

describe('SetupPage', () => {
  it('does not pretend persistence is available without credentials', () => {
    render(<SetupPage />)
    expect(screen.getByRole('heading', { name: /connect the application to supabase/i })).toBeInTheDocument()
    expect(screen.getByText(/persistence is intentionally unavailable/i)).toBeInTheDocument()
  })
})
