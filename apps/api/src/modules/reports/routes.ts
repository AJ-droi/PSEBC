import { Router } from 'express';
import { reportQuerySchema } from '@psebc/shared';
import { ah, parse } from '../../lib/http';
import { requireRole } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';
import { monthlyReport, reportToCsv } from './service';

export const reportsRouter = Router();

/** Admin and safeguarding only (7.1). */
reportsRouter.get(
  '/monthly',
  requireRole('admin', 'safeguarding'),
  ah(async (req, res) => {
    const { month } = parse(reportQuerySchema, req.query);
    res.json(await monthlyReport(month));
  }),
);

reportsRouter.get(
  '/monthly.csv',
  requireRole('admin', 'safeguarding'),
  ah(async (req, res) => {
    const { month } = parse(reportQuerySchema, req.query);
    const csv = reportToCsv(await monthlyReport(month));
    await audit(actorFrom(req), { action: 'report.download', entityType: 'report', entityId: month });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="psebc-lifts-${month}.csv"`);
    res.send(csv);
  }),
);
