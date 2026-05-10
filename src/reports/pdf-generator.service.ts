import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument: new (options?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument = require('pdfkit');
import { ProjectReportDataDto } from './dto/project-report-data.dto';

/**
 * Service de geração de PDF a partir dos dados de relatório de projeto.
 *
 * Responsável exclusivamente por renderizar o PDF usando PDFKit.
 * Não acessa Prisma, Engine nem emite eventos.
 *
 * Seções geradas:
 * 1. Header — nome do projeto, período, gerado em
 * 2. Resumo Executivo — stakeholder summary ou placeholder
 * 3. Flow Metrics — cycle time, lead time, throughput, wip age
 * 4. Velocity — série de pontos
 * 5. Burndown — série de pontos
 * 6. Tasks por Membro
 * 7. Forecast — p50, p75, p85, p95
 * 8. Riscos/Observações — warnings + highlights
 *
 * Performance target: <500ms para projeto típico.
 *
 * @example
 * ```typescript
 * const buffer = await pdfGeneratorService.generate(reportData);
 * // buffer começa com '%PDF'
 * ```
 */
@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);

  // Paleta de cores V2
  private readonly colors = {
    primary: '#1a237e',
    secondary: '#283593',
    accent: '#3949ab',
    text: '#212121',
    textSecondary: '#757575',
    border: '#e0e0e0',
    background: '#f5f5f5',
    success: '#2e7d32',
    warning: '#e65100',
    danger: '#b71c1c',
  };

  /**
   * Gera PDF binário a partir dos dados do relatório de projeto.
   *
   * Todos os campos opcionais são tratados com "N/A" se ausentes.
   * Nunca lança exceção por dados parciais — gera PDF degradado.
   *
   * @param data - Dados completos do relatório
   * @returns Buffer com conteúdo PDF válido (começa com %PDF)
   */
  async generate(data: ProjectReportDataDto): Promise<Buffer> {
    const start = Date.now();

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const doc = new PDFDocument({
          margin: 50,
          size: 'A4',
          info: {
            Title: `Relatório ${data.project.projectName}`,
            Author: 'Scrumban-Backend-V2',
            Subject: `Projeto ${data.project.projectId} — período ${data.period.from.slice(0, 10)} a ${data.period.to.slice(0, 10)}`,
            CreationDate: new Date(),
          },
        });

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const elapsed = Date.now() - start;
          this.logger.debug(`PDF gerado em ${elapsed}ms — ${buffer.length} bytes`);
          resolve(buffer);
        });
        doc.on('error', reject);

        this.renderDocument(doc, data);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Seções do documento
  // ---------------------------------------------------------------------------

  private renderDocument(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderHeader(doc, data);
    this.renderExecutiveSummary(doc, data);
    this.renderFlowMetrics(doc, data);
    this.renderVelocity(doc, data);
    this.renderBurndown(doc, data);
    this.renderTasksByUser(doc, data);
    this.renderForecast(doc, data);
    this.renderRisksAndObservations(doc, data);
  }

  // 1. Header
  private renderHeader(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    const { project, period, generatedAt } = data;

    // Fundo do cabeçalho
    doc.rect(0, 0, doc.page.width, 120).fill(this.colors.primary);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22);
    doc.text(this.truncate(project.projectName, 60), 50, 30, { lineBreak: false });

    doc.font('Helvetica').fontSize(11).fillColor('#c5cae9');
    doc.text('Relatório de Projeto', 50, 58);

    const fromStr = this.safeSlice(period.from, 10);
    const toStr = this.safeSlice(period.to, 10);
    const periodLabel = `Período: ${fromStr} a ${toStr} (${period.days} dias)`;
    doc.text(periodLabel, 50, 75);

    const genAt = this.safeSlice(generatedAt, 19).replace('T', ' ');
    doc.text(`Gerado em: ${genAt} UTC`, 50, 92);

    doc.moveDown(4);
    doc.fillColor(this.colors.text);
  }

  // 2. Resumo Executivo
  private renderExecutiveSummary(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderSectionTitle(doc, 'Resumo Executivo');

    const summary = data.stakeholderSummary;
    if (!summary) {
      this.renderPlaceholder(doc, 'Resumo executivo não disponível para este período.');
      return;
    }

    const execSummary = this.getStringField(summary, 'executiveSummary');
    if (execSummary) {
      doc.font('Helvetica').fontSize(10).fillColor(this.colors.text);
      doc.text(execSummary, { lineGap: 4 });
      doc.moveDown(0.5);
    }

    const highlights = this.getArrayField(summary, 'highlights');
    if (highlights.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).text('Destaques:');
      for (const h of highlights) {
        doc.font('Helvetica').fontSize(10).text(`  • ${String(h)}`, { lineGap: 2 });
      }
      doc.moveDown(0.5);
    }

    const risks = this.getArrayField(summary, 'risks');
    if (risks.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.warning).text('Riscos:');
      for (const r of risks) {
        doc.font('Helvetica').fontSize(10).fillColor(this.colors.text).text(`  • ${String(r)}`, { lineGap: 2 });
      }
      doc.moveDown(0.5);
    }
  }

  // 3. Flow Metrics
  private renderFlowMetrics(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderSectionTitle(doc, 'Flow Metrics');

    const metrics = data.metrics;
    if (!metrics) {
      this.renderPlaceholder(doc, 'Métricas de fluxo não disponíveis para este período.');
      return;
    }

    const metricsRows: [string, string][] = [
      ['Cycle Time (média)', this.formatHours(this.getNumericField(metrics, 'cycleTimeAvgHours', 'cycleTime.avg'))],
      ['Lead Time (média)', this.formatHours(this.getNumericField(metrics, 'leadTimeAvgHours', 'leadTime.avg'))],
      ['Throughput total', this.formatCount(this.getNumericField(metrics, 'throughputTotal', 'throughput.total'))],
      ['WIP total', this.formatCount(this.getNumericField(metrics, 'wipTotal', 'wipAge.total'))],
    ];

    this.renderKeyValueTable(doc, metricsRows);
  }

  // 4. Velocity
  private renderVelocity(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderSectionTitle(doc, 'Velocity');

    const velocity = data.velocity;
    if (!velocity) {
      this.renderPlaceholder(doc, 'Dados de velocity não disponíveis.');
      return;
    }

    const avg = this.getNumericField(velocity, 'avgVelocity');
    if (avg !== null) {
      doc.font('Helvetica').fontSize(10).text(`Velocity média: ${avg} tasks/sprint`);
      doc.moveDown(0.3);
    }

    const series = this.getArrayField(velocity, 'series');
    if (series.length > 0) {
      const rows: [string, string, string][] = [['Sprint/Período', 'Concluídas', 'Planejadas']];
      for (const item of series.slice(0, 15)) {
        const record = this.asRecord(item);
        if (!record) continue;
        rows.push([
          this.truncate(String(record.label ?? record.sprintId ?? '—'), 30),
          String(record.completed ?? '—'),
          String(record.planned ?? '—'),
        ]);
      }
      this.renderTable(doc, rows);
      if (series.length > 15) {
        doc.font('Helvetica').fontSize(9).fillColor(this.colors.textSecondary)
          .text(`(+ ${series.length - 15} sprints omitidos)`);
      }
    }
  }

  // 5. Burndown
  private renderBurndown(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderSectionTitle(doc, 'Burndown');

    const burndown = data.burndown;
    if (!burndown) {
      this.renderPlaceholder(doc, 'Dados de burndown não disponíveis.');
      return;
    }

    const scopeTotal = this.getNumericField(burndown, 'scopeTotal');
    const completedTotal = this.getNumericField(burndown, 'completedTotal');

    if (scopeTotal !== null || completedTotal !== null) {
      const rows: [string, string][] = [
        ['Total no escopo', scopeTotal !== null ? String(scopeTotal) : 'N/A'],
        ['Concluídas', completedTotal !== null ? String(completedTotal) : 'N/A'],
      ];
      if (scopeTotal !== null && completedTotal !== null && scopeTotal > 0) {
        rows.push(['Progresso', `${Math.round((completedTotal / scopeTotal) * 100)}%`]);
      }
      this.renderKeyValueTable(doc, rows);
    }

    const series = this.getArrayField(burndown, 'series');
    const sampled = this.sampleSeries(series, 10);
    if (sampled.length > 0) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(this.colors.text).text('Amostra de pontos:');
      doc.moveDown(0.2);
      const rows: [string, string, string][] = [['Data', 'Planejado', 'Atual']];
      for (const item of sampled) {
        const record = this.asRecord(item);
        if (!record) continue;
        rows.push([
          String(record.date ?? '—'),
          String(record.plannedRemaining ?? '—'),
          String(record.actualRemaining ?? '—'),
        ]);
      }
      this.renderTable(doc, rows);
    }
  }

  // 6. Tasks por Membro
  private renderTasksByUser(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderSectionTitle(doc, 'Tasks por Membro');

    const tasksByUser = data.tasksByUser;
    if (!tasksByUser) {
      this.renderPlaceholder(doc, 'Dados de tasks por usuário não disponíveis.');
      return;
    }

    const users = this.getArrayField(tasksByUser, 'users');
    if (users.length === 0) {
      this.renderPlaceholder(doc, 'Nenhum usuário com tasks no período.');
      return;
    }

    const rows: [string, string][] = [['Membro', 'Total de Tasks']];
    for (const user of users.slice(0, 20)) {
      const record = this.asRecord(user);
      if (!record) continue;
      const name = String(record.userName ?? record.userId ?? 'Unassigned');
      rows.push([this.truncate(name, 35), String(record.total ?? '0')]);
    }
    this.renderTable(doc, rows);

    if (users.length > 20) {
      doc.font('Helvetica').fontSize(9).fillColor(this.colors.textSecondary)
        .text(`(+ ${users.length - 20} membros omitidos)`);
    }
  }

  // 7. Forecast
  private renderForecast(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    this.renderSectionTitle(doc, 'Forecast Monte Carlo');

    const forecast = data.forecast;
    if (!forecast) {
      this.renderPlaceholder(doc, 'Forecast não disponível (histórico insuficiente).');
      return;
    }

    const rows: [string, string][] = [
      ['Tasks restantes', this.formatCount(this.getNumericField(forecast, 'tasksRemaining'))],
      ['P50 (50% confiança)', this.formatSprints(this.getNumericField(forecast, 'p50'))],
      ['P75 (75% confiança)', this.formatSprints(this.getNumericField(forecast, 'p75'))],
      ['P85 (85% confiança)', this.formatSprints(this.getNumericField(forecast, 'p85'))],
      ['P95 (95% confiança)', this.formatSprints(this.getNumericField(forecast, 'p95'))],
    ];

    this.renderKeyValueTable(doc, rows);

    const method = this.getStringField(forecast, 'method');
    if (method) {
      doc.font('Helvetica').fontSize(9).fillColor(this.colors.textSecondary)
        .text(`Método: ${method}`);
    }
  }

  // 8. Riscos e Observações
  private renderRisksAndObservations(doc: PDFKit.PDFDocument, data: ProjectReportDataDto): void {
    const warnings = data.warnings ?? [];
    const risks = this.getArrayField(data.stakeholderSummary ?? {}, 'risks');
    const nextActions = this.getArrayField(data.stakeholderSummary ?? {}, 'nextActions');

    const hasContent = warnings.length > 0 || risks.length > 0 || nextActions.length > 0;
    if (!hasContent) return;

    this.renderSectionTitle(doc, 'Riscos e Observações');

    if (warnings.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.warning).text('Avisos:');
      for (const w of warnings) {
        doc.font('Helvetica').fontSize(10).fillColor(this.colors.text).text(`  • ${w}`, { lineGap: 2 });
      }
      doc.moveDown(0.5);
    }

    if (nextActions.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.text).text('Próximas Ações:');
      for (const action of nextActions) {
        doc.font('Helvetica').fontSize(10).text(`  → ${String(action)}`, { lineGap: 2 });
      }
      doc.moveDown(0.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Primitivos de renderização
  // ---------------------------------------------------------------------------

  private renderSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    this.ensurePageSpace(doc, 60);

    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(40, y, doc.page.width - 80, 22).fill(this.colors.secondary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12);
    doc.text(title, 50, y + 5);
    doc.moveDown(0.8);
    doc.fillColor(this.colors.text);
  }

  private renderPlaceholder(doc: PDFKit.PDFDocument, message: string): void {
    doc.font('Helvetica').fontSize(10).fillColor(this.colors.textSecondary)
      .text(message, { lineGap: 4 });
    doc.moveDown(0.5);
  }

  /**
   * Renderiza uma tabela simples de chave-valor.
   */
  private renderKeyValueTable(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
    const colWidths = [180, 200];
    const rowHeight = 18;

    for (const [key, value] of rows) {
      this.ensurePageSpace(doc, rowHeight + 5);
      const y = doc.y;
      const x = 50;

      // Fundo alternado leve (cor uniforme para simplicidade)
      doc.rect(x, y, colWidths[0], rowHeight).fill(this.colors.background).stroke(this.colors.border);
      doc.rect(x + colWidths[0], y, colWidths[1], rowHeight).fill('#ffffff').stroke(this.colors.border);

      doc.fillColor(this.colors.text).font('Helvetica-Bold').fontSize(9);
      doc.text(key, x + 4, y + 4, { width: colWidths[0] - 8, lineBreak: false });

      doc.fillColor(this.colors.text).font('Helvetica').fontSize(9);
      doc.text(value, x + colWidths[0] + 4, y + 4, { width: colWidths[1] - 8, lineBreak: false });

      doc.y = y + rowHeight + 1;
    }

    doc.moveDown(0.5);
  }

  /**
   * Renderiza uma tabela com cabeçalho (primeira linha) e linhas de dados.
   */
  private renderTable(doc: PDFKit.PDFDocument, rows: [string, ...string[]][]): void {
    if (rows.length === 0) return;

    const colCount = rows[0].length;
    const pageWidth = doc.page.width - 100;
    const colWidth = Math.floor(pageWidth / colCount);
    const rowHeight = 18;

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      this.ensurePageSpace(doc, rowHeight + 5);
      const y = doc.y;
      const x = 50;
      const isHeader = rowIdx === 0;

      for (let colIdx = 0; colIdx < colCount; colIdx++) {
        const cellX = x + colIdx * colWidth;
        const bgColor = isHeader ? this.colors.accent : (rowIdx % 2 === 0 ? this.colors.background : '#ffffff');

        doc.rect(cellX, y, colWidth, rowHeight).fill(bgColor).stroke(this.colors.border);

        const textColor = isHeader ? '#ffffff' : this.colors.text;
        const font = isHeader ? 'Helvetica-Bold' : 'Helvetica';
        doc.fillColor(textColor).font(font).fontSize(8);
        doc.text(
          this.truncate(String(row[colIdx] ?? ''), 30),
          cellX + 3,
          y + 4,
          { width: colWidth - 6, lineBreak: false },
        );
      }

      doc.y = y + rowHeight + 1;
    }

    doc.moveDown(0.5);
  }

  // ---------------------------------------------------------------------------
  // Utilitários de dados
  // ---------------------------------------------------------------------------

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private getNumericField(obj: Record<string, unknown>, ...keys: string[]): number | null {
    for (const key of keys) {
      // Suporta chaves simples e com ponto (ex: 'cycleTime.avg')
      const parts = key.split('.');
      let current: unknown = obj;
      for (const part of parts) {
        current = this.asRecord(current)?.[part];
        if (current === undefined) break;
      }
      if (typeof current === 'number' && !Number.isNaN(current)) return current;
    }
    return null;
  }

  private getStringField(obj: Record<string, unknown>, key: string): string | null {
    const val = obj[key];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }

  private getArrayField(obj: Record<string, unknown>, key: string): unknown[] {
    const val = obj[key];
    return Array.isArray(val) ? val : [];
  }

  private formatHours(hours: number | null): string {
    if (hours === null) return 'N/A';
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${hours.toFixed(1)} h`;
  }

  private formatCount(count: number | null): string {
    if (count === null) return 'N/A';
    return String(Math.round(count));
  }

  private formatSprints(sprints: number | null): string {
    if (sprints === null) return 'N/A';
    return `${Math.ceil(sprints)} sprints`;
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
  }

  private safeSlice(str: string | undefined | null, len: number): string {
    if (!str) return '—';
    return str.slice(0, len);
  }

  /**
   * Amostra uniforme de uma série temporal para evitar páginas longas.
   */
  private sampleSeries(series: unknown[], maxPoints: number): unknown[] {
    if (series.length <= maxPoints) return series;
    const step = Math.ceil(series.length / maxPoints);
    return series.filter((_, idx) => idx % step === 0).slice(0, maxPoints);
  }

  /**
   * Garante espaço mínimo na página antes de renderizar um bloco.
   * Se não houver espaço, adiciona uma nova página.
   */
  private ensurePageSpace(doc: PDFKit.PDFDocument, minSpace: number): void {
    const remaining = doc.page.height - doc.page.margins.bottom - doc.y;
    if (remaining < minSpace) {
      doc.addPage();
    }
  }
}
