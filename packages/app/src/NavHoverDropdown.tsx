import { useState } from 'react';
import { NavDropdown } from 'react-bootstrap';

export default function NavHoverDropdown(
  props: React.ComponentProps<typeof NavDropdown>,
) {
  const [show, setShow] = useState(false);
  return (
    <NavDropdown
      {...props}
      show={show}
      onClick={() => setShow(v => !v)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    />
  );
}
