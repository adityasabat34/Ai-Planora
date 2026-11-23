import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isEmail } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { SignInMethod } from '../generated/prisma/client.js';
import { GOOGLE_PROOF_TTL_SECONDS } from './auth.constants.js';
import { AuthRepository, DuplicateAccountError } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import type { GoogleIdentity } from './auth.types.js';
import type { GoogleRegisterDto } from './dto/google-register.dto.js';
import { GoogleIdentityService } from './google.identity.service.js';

const NONCE_AUDIENCE = 'planora:google-nonce';
const SIGNUP_AUDIENCE = 'planora:google-signup';

@Injectable()
export class GoogleAuthService {
    constructor(
        private readonly identityService: GoogleIdentityService,
        private readonly jwtService: JwtService,
        private readonly authRepository: AuthRepository,
        private readonly authService: AuthService,
    ) { }

    async createChallenge() {
        const clientId = this.identityService.getClientId();
        const nonce = randomBytes(32).toString('hex');
        const cookie = await this.jwtService.signAsync({ nonce }, {
            audience: NONCE_AUDIENCE,
            expiresIn: GOOGLE_PROOF_TTL_SECONDS,
        });
        return { clientId, nonce, cookie };
    }

    async login(idToken: string, nonceCookie: unknown) {
        const proof = await this.verifyProof(nonceCookie, NONCE_AUDIENCE);
        if (typeof proof.nonce !== 'string') {
            throw new UnauthorizedException('Restart Google sign-in');
        }
        const identity = await this.identityService.verify(idToken, proof.nonce);
        const user = await this.authRepository.findUserByGoogleSub(identity.googleSub);
        if (user) {
            return { requiresSignup: false as const, session: await this.authService.createSessionForUser(user) };
        }

        await this.checkEmailAvailable(identity.email);
        const signupToken = await this.jwtService.signAsync(identity, {
            audience: SIGNUP_AUDIENCE,
            expiresIn: GOOGLE_PROOF_TTL_SECONDS,
        });
        return {
            requiresSignup: true as const,
            profile: { email: identity.email, fullName: identity.fullName },
            signupToken,
        };
    }

    async register(input: GoogleRegisterDto, signupCookie: unknown) {
        const identity = await this.readSignupIdentity(signupCookie);
        let user = await this.authRepository.findUserByGoogleSub(identity.googleSub);
        if (!user) {
            await this.checkEmailAvailable(identity.email);
            try {
                user = await this.authRepository.createGoogleUser({
                    googleSub: identity.googleSub,
                    email: identity.email,
                    fullName: input.fullName,
                });
            } catch (error) {
                if (!(error instanceof DuplicateAccountError)) throw error;
                // A retry or concurrent completion may already have created this Google account.
                user = await this.authRepository.findUserByGoogleSub(identity.googleSub);
                if (!user) {
                    await this.checkEmailAvailable(identity.email);
                    throw new ConflictException(error.message);
                }
            }
        }

        return this.authService.createSessionForUser(user);
    }

    private async checkEmailAvailable(email: string): Promise<void> {
        const existing = await this.authRepository.findUserByEmail(email);
        if (existing?.signInMethod === SignInMethod.PASSWORD) {
            throw new ConflictException('This email uses password sign-in. Sign in with your email and password');
        }
        if (existing) {
            throw new ConflictException('This email belongs to another Google account');
        }
    }

    private async verifyProof(cookie: unknown, audience: string): Promise<Record<string, unknown>> {
        if (typeof cookie !== 'string' || cookie.length > 10000) {
            throw new UnauthorizedException('Restart Google sign-in');
        }
        try {
            const payload: unknown = await this.jwtService.verifyAsync(cookie, { audience });
            if (typeof payload !== 'object' || payload === null || !('exp' in payload) || typeof payload.exp !== 'number') {
                throw new Error('Invalid Google sign-in proof');
            }
            return payload as Record<string, unknown>;
        } catch {
            throw new UnauthorizedException('Restart Google sign-in');
        }
    }

    private async readSignupIdentity(cookie: unknown): Promise<GoogleIdentity> {
        const proof = await this.verifyProof(cookie, SIGNUP_AUDIENCE);
        if (
            typeof proof.googleSub !== 'string' || !proof.googleSub || proof.googleSub.length > 255 ||
            typeof proof.email !== 'string' || !isEmail(proof.email) || proof.email.length > 254 ||
            typeof proof.fullName !== 'string'
        ) {
            throw new UnauthorizedException('Restart Google sign-in');
        }
        return { googleSub: proof.googleSub, email: proof.email, fullName: proof.fullName };
    }
}
