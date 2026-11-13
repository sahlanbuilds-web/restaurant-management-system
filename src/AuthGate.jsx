import { createContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './AuthGate.css';

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000/api`;
export const AuthContext = createContext(null);

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, credentials: 'include' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [topActions, setTopActions] = useState(null);

  useEffect(() => {
    if (user) document.body.dataset.role = user.role;
    else delete document.body.dataset.role;
    return () => { delete document.body.dataset.role; };
  }, [user]);

  useEffect(() => {
    setTopActions(user ? document.querySelector('.top-actions') : null);
  }, [user]);

  useEffect(() => {
    let active = true;
    request('/auth/me')
      .then((result) => { if (active) setUser(result.user); })
      .catch((loadError) => {
        if (active && !loadError.message.includes('Sign in') && !loadError.message.includes('session has expired')) {
          setError(loadError.message);
        }
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const result = await request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      setUser(result.user);
      setPassword('');
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSaving(false);
    }
  }

  async function signUp(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await request('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      setAuthMode('signin');
      setName('');
      setPassword('');
      setConfirmPassword('');
      setError('');
      setMessage('Account created. An administrator must activate it before you can sign in.');
    } catch (registrationError) {
      setError(registrationError.message);
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    setError('');
    setMenuOpen(false);
    try {
      await request('/auth/logout', { method: 'POST' });
      setUser(null);
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  if (checking) return <main className="auth-state">Checking your sign-in…</main>;
  if (!user) {
    return (
      <main className="auth-login">
        <form className="auth-login-card" onSubmit={authMode === 'signup' ? signUp : signIn}>
          <p className="auth-eyebrow">Proxima Technologies</p>
          <h1>{authMode === 'signup' ? 'Create an account' : 'Sign in'}</h1>
          <p>{authMode === 'signup' ? 'Register for a restaurant staff account.' : 'Use your restaurant staff account to continue.'}</p>
          {message && <div className="auth-success" role="status">{message}</div>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {authMode === 'signup' && <>
            <label htmlFor="auth-name">Full name</label>
            <input id="auth-name" autoComplete="name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </>}
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" type="email" autoComplete="username" required maxLength={150} value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} required minLength={authMode === 'signup' ? 10 : undefined} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} />
          {authMode === 'signup' && <>
            <label htmlFor="auth-confirm-password">Confirm password</label>
            <input id="auth-confirm-password" type="password" autoComplete="new-password" required minLength={10} maxLength={1024} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </>}
          <button type="submit" disabled={saving}>{saving ? (authMode === 'signup' ? 'Creating account…' : 'Signing in…') : (authMode === 'signup' ? 'Create account' : 'Sign in')}</button>
          <button type="button" className="auth-mode-toggle" disabled={saving} onClick={() => {
            setAuthMode((mode) => mode === 'signup' ? 'signin' : 'signup');
            setError('');
            setMessage('');
          }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Sign up'}</button>
        </form>
      </main>
    );
  }

  const initials = (user.name || user.email || 'AD').split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  return (
    <AuthContext.Provider value={user}>
      <div className="auth-session-bar">
        <div className="auth-breadcrumbs" aria-label="Breadcrumb">
          <span className="auth-brand">Proxima Technologies</span>
          <span className="auth-divider">/</span>
          <span className="auth-current">Dashboard</span>
        </div>

        <div className="auth-actions">
          <button type="button" className="auth-icon-button" aria-label="Search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="5.25" /><path d="M16 16L21 21" /></svg>
          </button>
          <button type="button" className="auth-icon-button" aria-label="Notifications">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 17h5l-1.2-1.2A2.7 2.7 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .8-.3 1.5-.8 2.1L4 17h5" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
          </button>

          <div className="auth-profile-menu">
            <button type="button" className="auth-profile-trigger" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="User menu">
              <span className="auth-avatar">{initials}</span>
              <span className="auth-profile-info">
                <strong>{user.name || 'Admin'}</strong>
                <small>{user.role || 'Manager'}</small>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
            </button>

            {menuOpen && (
              <div className="auth-profile-dropdown" role="menu" aria-label="User options">
                <button type="button" className="auth-dropdown-item" onClick={() => setMenuOpen(false)}>
                  Profile
                </button>
                <button type="button" className="auth-dropdown-item danger" onClick={signOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {error && <div className="auth-session-error" role="alert">{error}</div>}
      {children}
      {topActions && createPortal(
        <div className="auth-profile-menu">
          <button type="button" className="auth-profile-trigger" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="User menu">
            <span className="auth-avatar">{initials}</span>
            <span className="auth-profile-info">
              <strong>{user.name || 'Admin'}</strong>
              <small>{user.role || 'Manager'}</small>
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
          </button>
          {menuOpen && (
            <div className="auth-profile-dropdown" role="menu" aria-label="User options">
              <button type="button" className="auth-dropdown-item" onClick={() => setMenuOpen(false)}>Profile</button>
              <button type="button" className="auth-dropdown-item danger" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>,
        topActions
      )}
    </AuthContext.Provider>
  );
}
