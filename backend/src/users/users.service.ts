import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsernameAssignmentRejectedError, UsernameTakenError, UsersRepository } from './users.repository.js';
import { toUserProfile } from './user-profile.js';

@Injectable()
export class UsersService {
    constructor(private readonly usersRepository: UsersRepository) { }

    async setUsername(userId: string, username: string) {
        try {
            return toUserProfile(await this.usersRepository.setInitialUsername(userId, username));
        } catch (error) {
            if (error instanceof UsernameTakenError) {
                throw new ConflictException('Username is already in use');
            }
            if (error instanceof UsernameAssignmentRejectedError) {
                // Distinguish a deleted account from an already completed setup.
                await this.getCurrentUser(userId);
                throw new ConflictException('Username is already set');
            }
            throw error;
        }
    }

    async getUsernameAvailability(username: string) {
        const user = await this.usersRepository.findUserIdByUsername(username);
        return { username, available: user === null };  /// db return somthing either null or user id so (null === null = true) so this tell no username exist in the Db.
    }

    async getCurrentUser(userId: string) {
        const user = await this.usersRepository.findPublicUserById(userId);
        if (!user) {
            throw new UnauthorizedException('Account is no longer available');
        }

        return toUserProfile(user);
    }
}
