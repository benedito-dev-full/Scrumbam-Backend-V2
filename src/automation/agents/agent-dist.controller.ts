import { Controller, Get, Logger, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';

@ApiTags('agent-dist')
@Controller('agent-dist')
export class AgentDistController {
  private readonly logger = new Logger(AgentDistController.name);

  /**
   * Serve o script de instalação do scrumban-agent via HTTP
   *
   * Rota pública — sem JWT — porque o curl roda antes de qualquer autenticação.
   * O token de instalação é passado como variável de ambiente no pipe do shell:
   *   curl -fsSL https://scrumban.com.br/agent-dist/install.sh | INSTALL_TOKEN=xxx bash
   *
   * Em produção o arquivo fica em /app/agent/install.sh (copiado pelo Dockerfile).
   * Em desenvolvimento fica em <repo-root>/agent/install.sh.
   *
   * @param res - Response Express para streaming do arquivo
   *
   * @throws {404} Quando install.sh não encontrado no servidor
   *
   * @example
   * ```bash
   * curl -fsSL https://scrumban.com.br/agent-dist/install.sh | INSTALL_TOKEN=xxx bash
   * ```
   */
  @Get('install.sh')
  @ApiOperation({ summary: 'Serve o script de instalação do scrumban-agent' })
  @ApiResponse({ status: 200, description: 'Script shell retornado com Content-Type text/x-shellscript' })
  @ApiResponse({ status: 404, description: 'Script não encontrado no servidor' })
  serveInstallScript(@Res() res: Response): void {
    const scriptPath = join(process.cwd(), 'agent', 'install.sh');

    if (!existsSync(scriptPath)) {
      this.logger.warn(`install.sh não encontrado em ${scriptPath}`);
      res.status(404).json({ message: 'install.sh não encontrado' });
      return;
    }

    this.logger.log(`Servindo install.sh de ${scriptPath}`);
    res.setHeader('Content-Type', 'text/x-shellscript');
    res.setHeader('Content-Disposition', 'inline; filename="install.sh"');
    createReadStream(scriptPath).pipe(res);
  }
}
