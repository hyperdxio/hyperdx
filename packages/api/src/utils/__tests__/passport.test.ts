import passport from '@/utils/passport';

const mockFindUserById = jest.fn();

jest.mock('@/controllers/user', () => ({
  findUserById: (id: string) => mockFindUserById(id),
}));

// The two-argument form of `deserializeUser` is passport's own private
// implementation: it walks the same registered deserializer chain that
// `passport.session()` drives on every request. The session strategy also
// passes the request along, which is immaterial here because the deserializer
// registered above takes only `(id, done)`.
const deserializeSession = (id: string) =>
  new Promise<{ err: unknown; user: unknown }>(resolve => {
    passport.deserializeUser(id, (err, user) => resolve({ err, user }));
  });

describe('utils/passport', () => {
  afterEach(() => {
    mockFindUserById.mockReset();
  });

  it('deserializes the session user', async () => {
    const user = { _id: 'user-id', email: 'user@example.com' };
    mockFindUserById.mockResolvedValue(user);

    expect(await deserializeSession('user-id')).toEqual({ err: null, user });
  });

  it('treats a deleted session user as unauthenticated, not as an error', async () => {
    mockFindUserById.mockResolvedValue(null);

    // `user: false` is what passport makes of an explicit `done(null, false)`:
    // it clears the stale id from the session and leaves the request
    // unauthenticated. An error here fails every request for as long as the
    // browser keeps the cookie, and so does a bare `done(null)`, which
    // passport reports as "Failed to deserialize user out of session".
    expect(await deserializeSession('deleted-user-id')).toEqual({
      err: null,
      user: false,
    });
  });

  it('still surfaces lookup failures', async () => {
    const err = new Error('mongo is down');
    mockFindUserById.mockRejectedValue(err);

    expect(await deserializeSession('user-id')).toEqual({
      err,
      user: undefined,
    });
  });
});
