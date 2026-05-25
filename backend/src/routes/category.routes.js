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
      const parts = request.parts();
      let name = '';
      let description = '';
      let isPublic = true;
      let posterUrl = '';
      let filePart = null;

      for await (const part of parts) {
        if (part.type === 'file') {
          filePart = part;
        } else if (part.fieldname === 'name') {
          name = part.value;
        } else if (part.fieldname === 'description') {
          description = part.value;
        } else if (part.fieldname === 'is_public') {
          isPublic = part.value !== 'false';
        } else if (part.fieldname === 'poster_url') {
          posterUrl = part.value;
        }
      }

      if (!filePart) {
        return reply.status(400).send({ error: 'Video file is required' });
      }

      if (!name) {
        name = pathBasename(filePart.filename);
      }

      const movie = await categoryService.uploadMovie({
        categoryId: request.params.id,
        name,
        description,
        isPublic,
        posterUrl: posterUrl || null,
        fileStream: filePart.file,
        filename: filePart.filename,
        mimetype: filePart.mimetype,
      });

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
