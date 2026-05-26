import * as categoryService from '../services/category.service.js';
import { requireMinRole } from '../middleware/auth.js';
import { validate, createCategorySchema, updateCategorySchema, updateMovieSchema } from '../middleware/validate.js';

export default async function categoryRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async () => categoryService.listCategoriesWithCounts());

  fastify.get('/:id', async (request, reply) => {
    const data = await categoryService.getCategoryContents(request.params.id);
    if (!data) return reply.status(404).send({ error: 'Category not found' });
    return data;
  });

  fastify.post('/', {
    preHandler: [requireMinRole('operator'), validate(createCategorySchema)],
  }, async (request, reply) => {
    try {
      const category = await categoryService.createCategory(request.body);
      reply.status(201);
      return category;
    } catch (err) {
      return reply.status(409).send({ error: err.message });
    }
  });

  fastify.put('/:id', {
    preHandler: [requireMinRole('operator'), validate(updateCategorySchema)],
  }, async (request, reply) => {
    const category = await categoryService.updateCategory(request.params.id, request.body);
    if (!category) return reply.status(404).send({ error: 'Category not found' });
    return category;
  });

  fastify.delete('/:id', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    await categoryService.deleteCategory(request.params.id);
    reply.status(204);
  });

  fastify.post('/:id/movies/upload', {
    preHandler: [requireMinRole('operator')],
    config: {
      rateLimit: false,
    },
  }, async (request, reply) => {
    try {
      const fields = {};
      let movie = null;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') {
            part.file.resume();
            continue;
          }

          const name = fields.name?.trim() || pathBasename(part.filename);
          movie = await categoryService.uploadMovie({
            categoryId: request.params.id,
            name,
            description: fields.description?.trim() || '',
            isPublic: fields.is_public !== 'false',
            posterUrl: fields.poster_url?.trim() || null,
            fileStream: part.file,
            filename: part.filename,
            mimetype: part.mimetype,
          });
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      if (!movie) {
        return reply.status(400).send({ error: 'Video file is required' });
      }

      reply.status(201);
      return movie;
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put('/movies/:movieId', {
    preHandler: [requireMinRole('operator'), validate(updateMovieSchema)],
  }, async (request, reply) => {
    const movie = await categoryService.updateMovie(request.params.movieId, request.body);
    if (!movie) return reply.status(404).send({ error: 'Movie not found' });
    return movie;
  });

  fastify.delete('/movies/:movieId', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      await categoryService.deleteMovie(request.params.movieId);
      reply.status(204);
    } catch (err) {
      return reply.status(404).send({ error: err.message });
    }
  });
}

function pathBasename(filename) {
  if (!filename) return 'فيلم جديد';
  const base = filename.replace(/\\/g, '/').split('/').pop() || filename;
  return base.replace(/\.[^.]+$/, '');
}
