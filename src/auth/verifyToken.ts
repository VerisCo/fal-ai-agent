import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { AGENT_ID } from '../config.js';

export interface JWTPayload {
  sub: string;
  email?: string;
  scope?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

let jwksClient: jwksRsa.JwksClient;

function initializeJwksClient() {
  if (!jwksClient) {
    jwksClient = jwksRsa({
      jwksUri: process.env.COMMANDS_JWKS_URL || 'https://api.commands.com/.well-known/jwks.json',
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5
    });
  }
  return jwksClient;
}

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  const client = initializeJwksClient();
  client.getSigningKey(header.kid, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

export function verifyJwt(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Authorization header with Bearer token required'
      }
    });
    return;
  }

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256'],
      issuer: process.env.COMMANDS_JWT_ISSUER || 'https://api.commands.com',
      audience: process.env.COMMANDS_JWT_AUDIENCE || AGENT_ID
    },
    (err, decoded) => {
      if (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('JWT verification failed:', err.message);
        }
        res.status(401).json({
          error: {
            code: 'unauthorized',
            message: 'Invalid or expired token'
          }
        });
        return;
      }

      req.user = decoded as JWTPayload;
      next();
    }
  );
}
