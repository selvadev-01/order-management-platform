/**
 * Auth controllers — US-AUTH-1 (register), US-AUTH-2 (login), profile.
 */
import bcrypt from 'bcrypt';
import { conflict, unauthenticated, notFound, signToken, Role } from '@oms/shared';
import { User } from './models/user.model.js';
import { config } from './config.js';

/**
 * A bcrypt hash of a throwaway value, compared against when no user is found.
 *
 * Without this, a missing account returns fast (no hash to compare) while a
 * wrong password returns slow — a timing difference that discloses which
 * emails are registered. US-AUTH-2 AC2 requires the two paths be
 * indistinguishable, and identical response text alone does not achieve that.
 */
const TIMING_DECOY_HASH = bcrypt.hashSync('timing-decoy-value', 12);

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function issueToken(user) {
  return {
    token: signToken(user, config.JWT_SECRET, config.JWT_EXPIRES_IN),
    expiresIn: config.JWT_EXPIRES_IN,
    user: publicUser(user),
  };
}

/**
 * POST /api/auth/register
 *
 * Role is assigned server-side. The request body cannot influence it — the
 * schema stripped any `role` key before this runs.
 */
export async function register(req, res) {
  const { name, email, password } = req.body;

  const existing = await User.exists({ email });
  if (existing) {
    // Registration necessarily discloses that an email is taken; there is no
    // way to offer a usable signup flow otherwise. Login does not (see below).
    throw conflict('An account with this email already exists', [
      { field: 'email', message: 'Already registered' },
    ]);
  }

  // Assigning plaintext here is intentional: the model's pre-save hook
  // replaces it with a bcrypt digest before it is persisted.
  const user = await User.create({
    name,
    email,
    passwordHash: password,
    role: Role.CUSTOMER,
  });

  req.log?.info({ userId: String(user._id) }, 'user registered');
  res.status(201).json(issueToken(user));
}

/**
 * POST /api/auth/login
 *
 * Both failure modes — unknown email, wrong password — return the same message
 * and take comparable time (US-AUTH-2 AC2).
 */
export async function login(req, res) {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    await bcrypt.compare(password, TIMING_DECOY_HASH);
    req.log?.warn({ email }, 'login failed: no such account');
    throw unauthenticated('Invalid email or password');
  }

  // Guards the corrupt-record edge case: a user document missing its hash is
  // an authentication failure and an anomaly to investigate, not a 500.
  if (!user.passwordHash) {
    req.log?.error({ userId: String(user._id) }, 'user record has no password hash');
    throw unauthenticated('Invalid email or password');
  }

  const valid = await user.verifyPassword(password);
  if (!valid) {
    req.log?.warn({ userId: String(user._id) }, 'login failed: bad password');
    throw unauthenticated('Invalid email or password');
  }

  req.log?.info({ userId: String(user._id), role: user.role }, 'login succeeded');
  res.json(issueToken(user));
}

/** GET /api/users/me — requires a valid token. */
export async function me(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) throw notFound('User not found');
  res.json({ user: publicUser(user) });
}

/**
 * GET /api/auth/verify
 *
 * Lets other services confirm a token and resolve the current user. Services
 * verify JWTs locally with the shared secret; this exists for the cases where
 * fresh user state is needed rather than the token's claims.
 */
export async function verify(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) throw unauthenticated('User no longer exists');
  res.json({ valid: true, user: publicUser(user) });
}
