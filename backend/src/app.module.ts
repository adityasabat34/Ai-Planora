import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { EventModule } from './events/event.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [EventModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
