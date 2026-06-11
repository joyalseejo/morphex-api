import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { NotFoundError, ValidationError } from '../../middleware/errors.js';

const router = Router();
const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidJsonSchema(s) {
  return s !== null && typeof s === 'object' && s.type === 'object' && s.properties;
}

// Builds the "accessible by this workspace" clause
function accessible(workspaceId) {
  return { OR: [{ workspaceId }, { isSystem: true }] };
}

// ─── Zod bodies ───────────────────────────────────────────────────────────────

const jsonSchemaField = z
  .record(z.unknown())
  .refine(isValidJsonSchema, 'jsonSchema must be a JSON Schema object with type:"object" and properties');

const createSchemaBody = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes')
    .optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  jsonSchema: jsonSchemaField,
});

// PUT only allows metadata updates — use POST /:id/versions for schema changes
const updateSchemaBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
  })
  .refine(d => Object.keys(d).length > 0, 'Request body must include at least one field to update');

const createVersionBody = z.object({
  jsonSchema: jsonSchemaField,
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
});

const deprecateBody = z.object({
  deprecationMessage: z.string().min(1).max(500).optional(),
  successorSchemaId: z.string().optional(),
});

const importBody = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  jsonSchema: jsonSchemaField,
});

// ─── GET /v1/schemas ──────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { category, isSystem, search } = req.query;

    let where = {
      isLatest: true,
      ...accessible(req.workspace.id),
    };

    if (isSystem !== undefined) {
      where = isSystem === 'true'
        ? { isLatest: true, isSystem: true }
        : { isLatest: true, workspaceId: req.workspace.id, isSystem: false };
    }

    if (category) where.category = category;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const schemas = await prisma.schema.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        isSystem: true,
        version: true,
        isLatest: true,
        isDeprecated: true,
        createdAt: true,
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });

    res.json({ data: schemas, count: schemas.length });
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/schemas/import ──────────────────────────────────────────────────
// Must be declared before /:idOrSlug to avoid route shadowing on same method

router.post('/import', validate(importBody), async (req, res, next) => {
  try {
    const { name, description, category, jsonSchema } = req.body;
    const rawSlug = req.body.slug ?? slugify(name);

    // Resolve slug conflicts by appending counter
    let slug = rawSlug;
    let attempt = 1;
    while (true) {
      const conflict = await prisma.schema.findFirst({
        where: { workspaceId: req.workspace.id, slug, isLatest: true },
      });
      if (!conflict) break;
      slug = `${rawSlug}-${++attempt}`;
    }

    const schema = await prisma.schema.create({
      data: {
        workspaceId: req.workspace.id,
        name,
        slug,
        description: description ?? null,
        category: category ?? null,
        jsonSchema,
        isSystem: false,
        version: 1,
        isLatest: true,
      },
    });

    res.status(201).json({
      ...schema,
      ...(slug !== rawSlug && { _slugRenamed: true, _originalSlug: rawSlug }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/schemas ─────────────────────────────────────────────────────────

router.post('/', validate(createSchemaBody), async (req, res, next) => {
  try {
    const { name, description, category, jsonSchema } = req.body;
    const slug = req.body.slug ?? slugify(name);

    const existing = await prisma.schema.findFirst({
      where: { workspaceId: req.workspace.id, slug, isLatest: true },
    });
    if (existing) {
      throw new ValidationError('Schema slug already exists in your workspace', [
        { field: 'slug', message: `"${slug}" is already taken` },
      ]);
    }

    const schema = await prisma.schema.create({
      data: {
        workspaceId: req.workspace.id,
        name,
        slug,
        description: description ?? null,
        category: category ?? null,
        jsonSchema,
        isSystem: false,
        version: 1,
        isLatest: true,
      },
    });

    res.status(201).json(schema);
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/schemas/:idOrSlug ────────────────────────────────────────────────

router.get('/:idOrSlug', async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const versionNum = req.query.version ? parseInt(req.query.version, 10) : null;

    const schema = await prisma.schema.findFirst({
      where: {
        OR: [
          // ID lookup always returns that exact record regardless of version
          { id: idOrSlug, ...accessible(req.workspace.id) },
          // Slug lookup defaults to latest; ?version=N for a specific version
          {
            slug: idOrSlug,
            ...(versionNum ? { version: versionNum } : { isLatest: true }),
            ...accessible(req.workspace.id),
          },
        ],
      },
    });

    if (!schema) throw new NotFoundError(`Schema "${idOrSlug}" not found`);

    res.json(schema);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /v1/schemas/:id ──────────────────────────────────────────────────────

router.put('/:id', validate(updateSchemaBody), async (req, res, next) => {
  try {
    const existing = await prisma.schema.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id, isSystem: false },
    });

    if (!existing) throw new NotFoundError(`Schema ${req.params.id} not found`);

    const schema = await prisma.schema.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json(schema);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /v1/schemas/:id ───────────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.schema.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id, isSystem: false },
    });

    if (!existing) throw new NotFoundError(`Schema ${req.params.id} not found`);

    await prisma.schema.delete({ where: { id: req.params.id } });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/schemas/:id/versions ────────────────────────────────────────────

router.get('/:id/versions', async (req, res, next) => {
  try {
    const schema = await prisma.schema.findFirst({
      where: { id: req.params.id, ...accessible(req.workspace.id) },
    });

    if (!schema) throw new NotFoundError(`Schema ${req.params.id} not found`);

    const versions = await prisma.schema.findMany({
      where: {
        slug: schema.slug,
        ...(schema.isSystem
          ? { isSystem: true }
          : { workspaceId: schema.workspaceId }),
      },
      select: {
        id: true,
        version: true,
        isLatest: true,
        isDeprecated: true,
        deprecationMessage: true,
        parentSchemaId: true,
        createdAt: true,
      },
      orderBy: { version: 'asc' },
    });

    res.json({ slug: schema.slug, name: schema.name, versions });
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/schemas/:id/versions ───────────────────────────────────────────

router.post('/:id/versions', validate(createVersionBody), async (req, res, next) => {
  try {
    const { jsonSchema, name, description, category } = req.body;

    const existing = await prisma.schema.findFirst({
      where: {
        id: req.params.id,
        workspaceId: req.workspace.id,
        isSystem: false,
        isLatest: true,
      },
    });

    if (!existing) {
      throw new NotFoundError(
        `Schema ${req.params.id} not found, not workspace-owned, or not the latest version`
      );
    }

    const newVersion = await prisma.$transaction(async (tx) => {
      await tx.schema.update({
        where: { id: existing.id },
        data: { isLatest: false },
      });

      return tx.schema.create({
        data: {
          workspaceId: existing.workspaceId,
          name: name ?? existing.name,
          slug: existing.slug,
          description: description ?? existing.description,
          category: category ?? existing.category,
          jsonSchema,
          isSystem: false,
          version: existing.version + 1,
          parentSchemaId: existing.id,
          isLatest: true,
        },
      });
    });

    res.status(201).json(newVersion);
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/schemas/:id/deprecate ──────────────────────────────────────────

router.post('/:id/deprecate', validate(deprecateBody), async (req, res, next) => {
  try {
    const { deprecationMessage, successorSchemaId } = req.body;

    const existing = await prisma.schema.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id, isSystem: false },
    });

    if (!existing) throw new NotFoundError(`Schema ${req.params.id} not found`);

    if (existing.isDeprecated) {
      return res.json({ message: 'Schema is already deprecated', schema: existing });
    }

    if (successorSchemaId) {
      const successor = await prisma.schema.findFirst({
        where: { id: successorSchemaId, ...accessible(req.workspace.id) },
      });
      if (!successor) throw new NotFoundError(`Successor schema ${successorSchemaId} not found`);
    }

    const schema = await prisma.schema.update({
      where: { id: req.params.id },
      data: { isDeprecated: true, deprecationMessage: deprecationMessage ?? null },
    });

    res.json(schema);
  } catch (err) {
    next(err);
  }
});

// ─── GET /v1/schemas/:id/export ───────────────────────────────────────────────

router.get('/:id/export', async (req, res, next) => {
  try {
    const schema = await prisma.schema.findFirst({
      where: { id: req.params.id, ...accessible(req.workspace.id) },
    });

    if (!schema) throw new NotFoundError(`Schema ${req.params.id} not found`);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${schema.slug}-v${schema.version}.json"`
    );

    res.json({
      slug: schema.slug,
      name: schema.name,
      description: schema.description,
      category: schema.category,
      version: schema.version,
      jsonSchema: schema.jsonSchema,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
