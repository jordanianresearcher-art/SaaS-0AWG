import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field, Input, Select, Textarea } from './ui'

// The contract these pin: a Field's `error` prop is the ONLY thing a page has
// to pass. The red control styling, `aria-invalid`, and the description link
// to the message all follow from it. Before this, each of those was a separate
// prop a page could forget — and most did, which is why a form could show a
// red error above a control that still looked untouched.

describe('Field error wiring', () => {
  it('marks its control invalid and points at the message', () => {
    render(
      <Field label="Shop name" htmlFor="s-name" error="Shop name is required">
        <Input id="s-name" />
      </Field>,
    )
    const input = screen.getByLabelText('Shop name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent('Shop name is required')
  })

  it('announces the message as an alert', () => {
    render(
      <Field label="Phone" htmlFor="s-phone" error="Enter a phone number">
        <Input id="s-phone" />
      </Field>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a phone number')
  })

  it('leaves a healthy field entirely unmarked', () => {
    render(
      <Field label="Email" htmlFor="s-email" hint="Customers reply to this">
        <Input id="s-email" />
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('applies to selects and textareas, not just inputs', () => {
    render(
      <>
        <Field label="Category" htmlFor="f-cat" error="Pick one">
          <Select id="f-cat">
            <option>a</option>
          </Select>
        </Field>
        <Field label="Notes" htmlFor="f-notes" error="Too long">
          <Textarea id="f-notes" />
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'true')
  })

  it('lets a caller override the inherited state', () => {
    // A composite Field may hold one bad control and one fine one; the caller
    // has to be able to say so.
    render(
      <Field label="Year" htmlFor="f-year" error="Check the year">
        <Input id="f-year" aria-invalid={false} />
      </Field>,
    )
    expect(screen.getByLabelText('Year')).toHaveAttribute('aria-invalid', 'false')
  })

  it('does not mark a control that lives outside any Field', () => {
    render(<Input aria-label="Search" />)
    expect(screen.getByLabelText('Search')).not.toHaveAttribute('aria-invalid')
  })
})
