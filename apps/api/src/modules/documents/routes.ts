import { Router } from 'express';
import { queryOne } from '../../db/pool';
import { ah, uuidParam } from '../../lib/http';
import { forbidden, notFound } from '../../lib/errors';
import { currentUser, requireAuth } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';

export const documentsRouter = Router();

/**
 * Photos are shown to members once a driver accepts; licence and insurance
 * evidence is only for admin and safeguarding, and every opening is audited.
 */
documentsRouter.get(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const id = uuidParam(req);
    const doc = await queryOne<{ id: string; driver_id: string; kind: string; filename: string; mime_type: string; data: Buffer }>('SELECT * FROM documents WHERE id = $1', [id]);
    if (!doc) throw notFound('Document');
    const user = currentUser(req);
    if (doc.kind !== 'photo' && !['admin', 'safeguarding'].includes(user.role)) throw forbidden();
    if (doc.kind !== 'photo') await audit(actorFrom(req), { action: 'document.open', entityType: 'driver', entityId: doc.driver_id, details: { kind: doc.kind, documentId: id } });
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${doc.kind === 'photo' ? 'inline' : 'attachment'}; filename="${doc.filename.replace(/"/g, '')}"`);
    res.send(doc.data);
  }),
);
