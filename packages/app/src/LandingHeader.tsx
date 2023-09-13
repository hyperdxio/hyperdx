import Link from 'next/link';
import { Button, Container, Navbar, Nav, NavDropdown } from 'react-bootstrap';

import Logo from './Logo';
import NavHoverDropdown from './NavHoverDropdown';
import api from './api';

export default function LandingHeader({ activeKey }: { activeKey: string }) {
  const { data: me } = api.useMe();
  const isLoggedIn = Boolean(me);

  const { data: installation } = api.useInstallation();

  return (
    <>
      <Navbar
        collapseOnSelect
        expand="lg"
        variant="dark"
        fixed="top"
        style={{ background: '#0f1216b3', backdropFilter: 'blur(12px)' }}
      >
        <Container fluid className="mx-md-4 mt-3">
          <Navbar.Brand href="/">
            <Logo />
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="responsive-navbar-nav" />
          <Navbar.Collapse className="justify-content-end">
            <Nav style={{ fontSize: 14 }} activeKey={activeKey}>
              <Nav.Link href="https://hyperdx.io" className="mx-2">
                HyperDX Cloud
              </Nav.Link>
              <Nav.Link href="https://hyperdx.io/docs" className="mx-2">
                Docs
              </Nav.Link>
              {!isLoggedIn && installation?.isTeamExisting === true && (
                <Nav.Link
                  href="/login"
                  active={activeKey === '/login'}
                  className="mx-2"
                >
                  Login
                </Nav.Link>
              )}
              {!isLoggedIn &&
                activeKey !== '/register' &&
                installation?.isTeamExisting === false && (
                  <div className="d-flex align-items-center mx-2">
                    <Link href={'/register'} passHref>
                      <Button variant="outline-success" className="fs-7.5">
                        Setup Account
                      </Button>
                    </Link>
                  </div>
                )}
              {isLoggedIn && (
                <div className="d-flex align-items-center mx-2">
                  <Link href="/search" passHref>
                    <Button
                      variant="outline-success"
                      className="px-3"
                      size="sm"
                    >
                      Go to Search
                    </Button>
                  </Link>
                </div>
              )}
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>
      <div style={{ height: 70 }} />
    </>
  );
}
