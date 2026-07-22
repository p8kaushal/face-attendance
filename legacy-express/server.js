import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import localAuthRoutes from './routes/localAuth.js';
import userRoutes from './routes/users.js';
import attendanceRoutes from './routes/attendance.js';
import eventsRoutes from './routes/events.js';
import { initDB } from './db/database.js';

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3001', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function isAdmin(user) {
  if (!user) return false;
  const identifier = (user.email || '').toLowerCase();
  const username = (user.username || '').toLowerCase();
  return ADMIN_USERS.includes(identifier) || ADMIN_USERS.includes(username);
}

passport.serializeUser((user, done) => done(null, JSON.stringify(user)));
passport.deserializeUser((str, done) => {
  try {
    done(null, JSON.parse(str));
  } catch (e) {
    done(e);
  }
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
  const isUserAdmin = isAdmin({ email: profile.emails?.[0]?.value });
  const user = {
    provider: 'google',
    id: profile.id,
    email: profile.emails?.[0]?.value,
    name: profile.displayName,
    avatar: profile.photos?.[0]?.value,
    isAdmin: isUserAdmin,
    role: isUserAdmin ? 'admin' : 'attendee'
  };
  return done(null, user);
}));

passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: process.env.GITHUB_CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
  const isUserAdmin = isAdmin({ username: profile.username, email: profile.emails?.[0]?.value });
  const user = {
    provider: 'github',
    id: profile.id,
    username: profile.username,
    email: profile.emails?.[0]?.value,
    name: profile.displayName,
    avatar: profile.photos?.[0]?.value,
    isAdmin: isUserAdmin,
    role: isUserAdmin ? 'admin' : 'attendee'
  };
  return done(null, user);
}));

app.use('/auth', authRoutes);
app.use('/auth/local', localAuthRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/events', eventsRoutes);

app.use(express.static('frontend'));

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(new URL('./frontend/index.html', import.meta.url).pathname);
});

async function start() {
  await initDB();
  app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
  });
}

start();
