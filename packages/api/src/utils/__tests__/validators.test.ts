import * as validators from '@/utils/validators';

describe('validators', () => {
  describe('isPrivateIp', () => {
    it.each([
      ['unspecified IPv4 address', '0.0.0.0'],
      ['first address in the IPv4 "this network" range', '0.0.0.1'],
      ['last address in the IPv4 "this network" range', '0.255.255.255'],
      ['first address in 10.0.0.0/8', '10.0.0.0'],
      ['last address in 10.0.0.0/8', '10.255.255.255'],
      ['first address in the shared address space', '100.64.0.0'],
      ['last address in the shared address space', '100.127.255.255'],
      ['first IPv4 loopback address', '127.0.0.0'],
      ['last IPv4 loopback address', '127.255.255.255'],
      ['first IPv4 link-local address', '169.254.0.0'],
      ['last IPv4 link-local address', '169.254.255.255'],
      ['first address in 172.16.0.0/12', '172.16.0.0'],
      ['last address in 172.16.0.0/12', '172.31.255.255'],
      ['first address in 192.168.0.0/16', '192.168.0.0'],
      ['last address in 192.168.0.0/16', '192.168.255.255'],
      ['first IPv4 multicast address', '224.0.0.0'],
      ['last IPv4 multicast address', '239.255.255.255'],
      ['first reserved high IPv4 address', '240.0.0.0'],
      ['limited broadcast address', '255.255.255.255'],
    ])('blocks the %s (%s)', (_description, ip) => {
      expect(validators.isPrivateIp(ip)).toBe(true);
    });

    it.each([
      ['IETF protocol assignments', '192.0.0.0'],
      ['documentation range TEST-NET-1', '192.0.2.1'],
      ['benchmarking range', '198.18.0.1'],
      ['documentation range TEST-NET-2', '198.51.100.1'],
      ['documentation range TEST-NET-3', '203.0.113.1'],
    ])('blocks the reserved IPv4 %s address (%s)', (_description, ip) => {
      expect(validators.isPrivateIp(ip)).toBe(true);
    });

    it.each([
      '1.0.0.0',
      '9.255.255.255',
      '11.0.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '126.255.255.255',
      '128.0.0.0',
      '169.253.255.255',
      '169.255.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.167.255.255',
      '192.169.0.0',
      '223.255.255.255',
    ])('allows the public IPv4 boundary address %s', ip => {
      expect(validators.isPrivateIp(ip)).toBe(false);
    });

    it.each([
      ['unspecified IPv6 address', '::'],
      ['IPv6 loopback address', '::1'],
      ['first IPv6 link-local address', 'fe80::'],
      [
        'last IPv6 link-local address',
        'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      ],
      ['first unique-local address', 'fc00::'],
      ['last unique-local address', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
      ['first IPv6 multicast address', 'ff00::'],
      [
        'last IPv6 multicast address',
        'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      ],
      ['fully expanded IPv6 loopback address', '0:0:0:0:0:0:0:0001'],
      ['uppercase unique-local address', 'FC00::ABCD'],
    ])('blocks the %s (%s)', (_description, ip) => {
      expect(validators.isPrivateIp(ip)).toBe(true);
    });

    it.each([
      ['IPv4-compatible loopback address', '::127.0.0.1'],
      ['discard-only address', '100::1'],
      ['documentation address', '2001:db8::1'],
    ])('blocks the reserved IPv6 %s (%s)', (_description, ip) => {
      expect(validators.isPrivateIp(ip)).toBe(true);
    });

    it.each([
      ['mapped private address', '::ffff:10.0.0.1', true],
      ['mapped loopback address', '::ffff:127.0.0.1', true],
      ['mapped link-local address', '::ffff:169.254.1.1', true],
      ['mapped public address', '::ffff:8.8.8.8', false],
      ['mapped private address in hexadecimal form', '::ffff:ac10:1', true],
      ['mapped public address in hexadecimal form', '::ffff:808:808', false],
      ['private IPv4 address with a CIDR suffix', '127.0.0.1/8', true],
      ['scoped IPv6 link-local address', 'fe80::1%lo0', true],
    ])('%s (%s)', (_description, ip, expected) => {
      expect(validators.isPrivateIp(ip)).toBe(expected);
    });

    it.each(['2001:4860:4860::8888', '2606:4700:4700::1111'])(
      'allows the public IPv6 address %s',
      ip => {
        expect(validators.isPrivateIp(ip)).toBe(false);
      },
    );

    it.each([
      '',
      'localhost',
      ' 127.0.0.1',
      '127.0.0.1 ',
      '127.1',
      '0177.0.0.1',
      '2130706433',
      '0x7f000001',
      '256.0.0.1',
      '[::1]',
      '2001:db8:::1',
    ])('rejects the non-canonical or invalid IP input %j', ip => {
      expect(validators.isPrivateIp(ip)).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should return true if password is valid', () => {
      expect(validators.validatePassword('aB3!efghijkl')).toBe(true);
      expect(validators.validatePassword('ValidPass123!')).toBe(true);
    });

    it('should return false if password is invalid', () => {
      expect(validators.validatePassword(null as any)).toBe(false);
      expect(validators.validatePassword(undefined as any)).toBe(false);
      expect(validators.validatePassword('')).toBe(false);
      expect(validators.validatePassword('1234567')).toBe(false);
      expect(validators.validatePassword('abcdefghijk')).toBe(false); // 11 chars
      expect(validators.validatePassword('abcdefghijkl')).toBe(false); // no upper/num/special
      expect(validators.validatePassword('ABCDEFGHIJKL')).toBe(false); // no lower/num/special
      expect(validators.validatePassword('Abcdefghijkl')).toBe(false); // no num/special
      expect(validators.validatePassword('Abcdefghijk1')).toBe(false); // no special
      expect(validators.validatePassword('Abcdefghijk!')).toBe(false); // no num
      expect(validators.validatePassword('ValidPass123!'.repeat(6))).toBe(
        false,
      ); // 78 chars (over 72)
    });
  });
});
