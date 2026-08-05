const errorHandler = (err, req, res, next) => {
  console.error('[error]', {
    path: req.originalUrl,
    method: req.method,
    statusCode: err.statusCode || 500,
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
    stack: err.stack,
  });

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
  });
};

export default errorHandler;
