import { next } from '@vercel/functions';

const REALM = 'Tabscape';
const DEFAULT_USER = 'tabscape';

export const config = {
  matcher: '/:path*',
};

export default function middleware(request) {
  const expectedUser = process.env.AUTH_USER || DEFAULT_USER;
  const expectedPassword = process.env.AUTH_PASSWORD;

  if (!expectedPassword) {
    return new Response('Password protection is not configured.', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'));
  if (credentials &&
      credentials.username === expectedUser &&
      credentials.password === expectedPassword) {
    return next();
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch (_) {
    return null;
  }
}
