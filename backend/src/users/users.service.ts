import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
    constructor(private readonly usersRepository: UsersRepository) { }

    async getCurrentUser(userId: string) {
        const user = await this.usersRepository.findPublicUserById(userId);
        if (!user) {
            throw new UnauthorizedException('Account is no longer available');
        }

        return user;
    }
}
