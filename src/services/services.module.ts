import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller.js';
@Module({ controllers: [ServicesController] })
export class ServicesModule {}
