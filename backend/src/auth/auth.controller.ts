import { Body, Controller, Post, ValidationPipe } from "@nestjs/common"
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post("register")
    register(
        @Body(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }))
        body: RegisterDto
    ) {
        return this.authService.register(body);
    }
}
