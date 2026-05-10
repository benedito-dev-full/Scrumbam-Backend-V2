import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsController } from '../reports.controller';
import { ReportsService } from '../reports.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrgTenantGuard } from '../../auth/guards/org-tenant.guard';

const MOCK_PDF_BUFFER = Buffer.from('%PDF-1.4 mock content');

const MOCK_USER = {
  sub: 'user-100',
  organizationId: '456',
  email: 'user@test.com',
  dUserGroupId: '100',
};

const mockResponse = () => {
  const res: Record<string, jest.Mock> = {
    setHeader: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return res;
};

describe('ReportsController', () => {
  let controller: ReportsController;
  let reportsService: jest.Mocked<ReportsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: {
            generateProjectPdf: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrgTenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReportsController>(ReportsController);
    reportsService = module.get(ReportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProjectPdf', () => {
    it('deve chamar generateProjectPdf e setar headers corretos', async () => {
      (reportsService.generateProjectPdf as jest.Mock).mockResolvedValue(MOCK_PDF_BUFFER);
      const res = mockResponse();

      await controller.getProjectPdf('123', { periodDays: 30 }, MOCK_USER as any, res as any);

      expect(reportsService.generateProjectPdf).toHaveBeenCalledWith('123', '456', { periodDays: 30 });
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="project-123-report.pdf"',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', MOCK_PDF_BUFFER.length);
      expect(res.end).toHaveBeenCalledWith(MOCK_PDF_BUFFER);
    });

    it('deve propagar NotFoundException quando projeto nao existe (404)', async () => {
      (reportsService.generateProjectPdf as jest.Mock).mockRejectedValue(
        new NotFoundException('Projeto 999 não encontrado'),
      );
      const res = mockResponse();

      await expect(
        controller.getProjectPdf('999', {}, MOCK_USER as any, res as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve propagar ForbiddenException quando org divergente (403)', async () => {
      (reportsService.generateProjectPdf as jest.Mock).mockRejectedValue(
        new ForbiddenException('Acesso negado: projeto pertence a outra organização'),
      );
      const res = mockResponse();

      await expect(
        controller.getProjectPdf('123', {}, MOCK_USER as any, res as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve usar organizationId do user para isolamento de tenant', async () => {
      (reportsService.generateProjectPdf as jest.Mock).mockResolvedValue(MOCK_PDF_BUFFER);
      const res = mockResponse();
      const userWithDiffOrg = { ...MOCK_USER, organizationId: '789' };

      await controller.getProjectPdf('123', {}, userWithDiffOrg as any, res as any);

      expect(reportsService.generateProjectPdf).toHaveBeenCalledWith('123', '789', {});
    });

    it('deve setar Content-Disposition com projectId correto no filename', async () => {
      (reportsService.generateProjectPdf as jest.Mock).mockResolvedValue(MOCK_PDF_BUFFER);
      const res = mockResponse();

      await controller.getProjectPdf('456', {}, MOCK_USER as any, res as any);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="project-456-report.pdf"',
      );
    });

    it('deve passar query params corretamente para o service', async () => {
      (reportsService.generateProjectPdf as jest.Mock).mockResolvedValue(MOCK_PDF_BUFFER);
      const res = mockResponse();
      const query = {
        periodDays: 60,
        includeTasks: true,
        includeStakeholderSummary: false,
      };

      await controller.getProjectPdf('123', query, MOCK_USER as any, res as any);

      expect(reportsService.generateProjectPdf).toHaveBeenCalledWith('123', '456', query);
    });
  });
});
