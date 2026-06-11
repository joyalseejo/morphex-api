import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import extractRouter, { testRouter as extractTestRouter } from './v1/extract.js';
import schemasRouter from './v1/schemas.js';
import keysRouter from './v1/keys.js';
import usageRouter from './v1/usage.js';
import workspaceRouter from './v1/workspace.js';
import webhooksRouter from './v1/webhooks.js';

const router = Router();

// No-auth endpoint — must be registered before authenticate middleware
router.use('/extract/test', extractTestRouter);

// All other v1 routes require a valid API key
router.use(authenticate);

router.use('/extract',   extractRouter);
router.use('/schemas',   schemasRouter);
router.use('/keys',      keysRouter);
router.use('/usage',     usageRouter);
router.use('/workspace', workspaceRouter);
router.use('/webhooks',  webhooksRouter);

export default router;
