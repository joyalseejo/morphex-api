import { ValidationError } from './errors.js';

export function validate(zodSchema) {
  return (req, res, next) => {
    const result = zodSchema.safeParse(req.body);

    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new ValidationError('Request body validation failed', fields));
    }

    // Replace req.body with the coerced/defaulted output from Zod
    req.body = result.data;
    next();
  };
}
