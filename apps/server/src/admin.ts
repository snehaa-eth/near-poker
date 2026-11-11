import crypto from 'node:crypto';

import type { Request, Response, NextFunction } from 'express';

export const ADMIN_COOKIE = 'poker_admin';

function adminPassword() {
  return process.env.ADMIN_PASSWORD?.trim() || 'admin123';
}

export function adminToken() {
  return crypto
    .createHmac('sha256', adminPassword())
    .update('midnight-poker-admin')
    .digest('hex');
}

export function isAdminRequest(req: {
  cookies?: Record<string, string>;
}): boolean {
  const cookie = req.cookies?.[ADMIN_COOKIE];
  return Boolean(cookie && cookie === adminToken());
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: 'AdminOnly' });
    return;
  }
  next();
}

export function verifyAdminPassword(password: string) {
  const expected = adminPassword();
  if (!password || password.length === 0) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function setAdminCookie(res: Response) {
  res.cookie(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12, // 12h
  });
}

export function clearAdminCookie(res: Response) {
  res.clearCookie(ADMIN_COOKIE);
}
