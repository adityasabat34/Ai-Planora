import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
    constructor(private readonly usersRepository: UsersRepository) { }

    async getUsernameAvailability(username: string) {
        const user = await this.usersRepository.findUserIdByUsername(username);
        return { username, available: user === null };  /// db return somthing either null or user id so (null === null = true) so this tell no username exist in the Db.
    }

    async getCurrentUser(userId: string) {
        const user = await this.usersRepository.findPublicUserById(userId);
        if (!user) {
            throw new UnauthorizedException('Account is no longer available');
        }

        return user;
    }
}
