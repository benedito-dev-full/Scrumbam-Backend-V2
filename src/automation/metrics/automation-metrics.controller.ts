import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AutomationMetricsResponseDto } from './automation-metrics.dto';
import { AutomationMetricsService } from './automation-metrics.service';

@ApiTags('automation-metrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('automation/metrics')
export class AutomationMetricsController {
  constructor(private readonly metricsService: AutomationMetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Resumo operacional da automacao F13' })
  @ApiResponse({ status: 200, type: AutomationMetricsResponseDto })
  async overview(): Promise<AutomationMetricsResponseDto> {
    return this.metricsService.getOverview();
  }
}
