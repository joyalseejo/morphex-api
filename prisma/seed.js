import { PrismaClient } from '@prisma/client';
import { SYSTEM_SCHEMAS } from '../src/utils/schemaTemplates.js';

const prisma = new PrismaClient();

async function seed() {
  let seeded = 0;
  let updated = 0;

  for (const template of SYSTEM_SCHEMAS) {
    const existing = await prisma.schema.findFirst({
      where: { slug: template.slug, isSystem: true },
    });

    if (existing) {
      await prisma.schema.update({
        where: { id: existing.id },
        data: {
          name:        template.name,
          description: template.description,
          category:    template.category,
          jsonSchema:  template.jsonSchema,
        },
      });
      updated++;
    } else {
      await prisma.schema.create({
        data: {
          workspaceId: null,
          name:        template.name,
          slug:        template.slug,
          description: template.description,
          category:    template.category,
          jsonSchema:  template.jsonSchema,
          isSystem:    true,
          version:     1,
        },
      });
      seeded++;
    }
  }

  console.log(`Seeded ${seeded} system schemas, updated ${updated}.`);
}

seed()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
