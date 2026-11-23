import type { PublicUser } from '../auth/auth.types.js';

export function toUserProfile(user: PublicUser) {
    return { ...user, onboardingRequired: user.username === null };
}
