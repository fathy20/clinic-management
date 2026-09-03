import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { DrizzleService } from '../../database/drizzle.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DrizzleService) {}

  @Public()
  @Get()
  async check() {
    return {
      status: 'ok',
      database: (await this.db.ping()) ? 'up' : 'down',
      time: new Date().toISOString(),
    };
  }
}
