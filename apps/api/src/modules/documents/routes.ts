import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { documents } from '../../db/schema';
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
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) throw notFound('Document');
    const user = currentUser(req);
    if (doc.kind !== 'photo' && !['admin', 'safeguarding'].includes(user.role)) throw forbidden();
    if (doc.kind !== 'photo') await audit(actorFrom(req), { action: 'document.open', entityType: 'driver', entityId: doc.driverId, details: { kind: doc.kind, documentId: id } });
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', `${doc.kind === 'photo' ? 'inline' : 'attachment'}; filename="${doc.filename.replace(/"/g, '')}"`);
    res.send(doc.data);
  }),
);
