import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormError } from '@/components/form/form-error';
import { TextField } from '@/components/form/text-field';

describe('form building blocks (05 §7)', () => {
  it('ties the label, hint and error to the input', () => {
    render(<TextField label="Email" id="email" hint="We never share it" error="Required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'email-hint email-error');
    expect(screen.getByText('Required')).toHaveAttribute('id', 'email-error');
  });

  it('no error, no aria-invalid; an empty form error renders nothing', () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
    const { container } = render(<FormError>{null}</FormError>);
    expect(container).toBeEmptyDOMElement();
  });
});
